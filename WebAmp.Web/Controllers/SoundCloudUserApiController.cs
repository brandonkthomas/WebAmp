using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using WebAmp.Web.SoundCloud;

namespace WebAmp.Web.Controllers;

// ============================================================================================
/// <summary>
/// User-scoped SoundCloud API proxy (Authorization Code flow).
/// </summary>
public sealed class SoundCloudUserApiController(SoundCloudUserAuthService auth, SoundCloudUserApiClient api) : ControllerBase
{
    // ============================================================================================
    /// <summary>
    /// Returns whether a SoundCloud user session is active and, if possible,
    /// basic profile info from /me.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Status()
    {
        var token = await auth.GetValidAccessTokenAsync(HttpContext);
        if (string.IsNullOrWhiteSpace(token))
        {
            return Ok(new { isAuthenticated = false, profile = (object?)null });
        }

        var (status, json) = await api.GetAsync(HttpContext, "me");
        if (status != HttpStatusCode.OK || json is null)
        {
            return Ok(new { isAuthenticated = true, profile = (object?)null });
        }

        return Ok(new
        {
            isAuthenticated = true,
            profile = JsonSerializer.Deserialize<object>(json.RootElement.GetRawText(), new JsonSerializerOptions(JsonSerializerDefaults.Web))
        });
    }

    // ============================================================================================
    /// <summary>
    /// Logs out the SoundCloud user by clearing the auth ticket.
    /// </summary>
    [HttpPost]
    public IActionResult Logout()
    {
        auth.ClearTicket(HttpContext);
        return Ok(new { ok = true });
    }

    // ============================================================================================
    /// <summary>
    /// Returns the authenticated user's playlists (paged).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> MyPlaylists(
        [FromQuery] int limit = 20,
        [FromQuery] string? cursor = null)
    {
        limit = Math.Clamp(limit, 1, 50);
        var path = $"me/playlists?limit={limit}&linked_partitioning=true&show_tracks=false";
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            path += $"&cursor={Uri.EscapeDataString(cursor)}";
        }

        var (status, json) = await api.GetAsync(HttpContext, path);
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the authenticated user's liked tracks (paged).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> LikedTracks(
        [FromQuery] int limit = 20,
        [FromQuery] string? cursor = null)
    {
        limit = Math.Clamp(limit, 1, 50);
        var path = $"me/likes/tracks?limit={limit}&linked_partitioning=true";
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            path += $"&cursor={Uri.EscapeDataString(cursor)}";
        }

        var (status, json) = await api.GetAsync(HttpContext, path);
        return ProxyJson(status, json);
    }

    [HttpPost]
    public async Task<IActionResult> LikeTrack([FromQuery] string trackUrn)
    {
        if (string.IsNullOrWhiteSpace(trackUrn)) return BadRequest(new { error = "missing_track_urn" });

        var encodedTrackUrn = Uri.EscapeDataString(trackUrn);
        var (status, json) = await api.PostJsonAsync(HttpContext, $"likes/tracks/{encodedTrackUrn}");
        return ProxyJson(status, json, allowEmptyOk: true);
    }

    [HttpPost]
    public async Task<IActionResult> UnlikeTrack([FromQuery] string trackUrn)
    {
        if (string.IsNullOrWhiteSpace(trackUrn)) return BadRequest(new { error = "missing_track_urn" });

        var encodedTrackUrn = Uri.EscapeDataString(trackUrn);
        var (status, json) = await api.DeleteAsync(HttpContext, $"likes/tracks/{encodedTrackUrn}");
        return ProxyJson(status, json, allowEmptyOk: true);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the authenticated user's recent activities (own tracks/playlists).
    /// Used by the "Recent" card on the Home view for SoundCloud.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> RecentActivities(
        [FromQuery] int limit = 10,
        [FromQuery] string? cursor = null)
    {
        limit = Math.Clamp(limit, 1, 50);
        var path = $"me/activities/all/own?limit={limit}&linked_partitioning=true";
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            path += $"&cursor={Uri.EscapeDataString(cursor)}";
        }

        var (status, json) = await api.GetAsync(HttpContext, path);
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns metadata for a specific playlist owned by or visible to the
    /// authenticated user.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Playlist([FromQuery] string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return BadRequest(new { error = "missing_id" });

        // Default representation includes tracks array; clients can choose to
        // ignore it and page via /playlists/{id}/tracks when needed.
        var encoded = Uri.EscapeDataString(id);
        var (status, json) = await api.GetAsync(HttpContext, $"playlists/{encoded}");
        return ProxyJson(status, json);
    }

    [HttpGet]
    public async Task<IActionResult> Track([FromQuery] string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return BadRequest(new { error = "missing_id" });

        var encoded = Uri.EscapeDataString(id);
        var (status, json) = await api.GetAsync(HttpContext, $"tracks/{encoded}");
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns tracks for a specific playlist using linked partitioning.
    /// First page: pass id (and optionally limit). Subsequent pages: pass next_href
    /// from the previous response (SoundCloud returns a full API URL).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> PlaylistTracks(
        [FromQuery] string? id,
        [FromQuery] int limit = 100,
        [FromQuery] string? cursor = null,
        [FromQuery] string? next_href = null)
    {
        string pathOrUrl;
        if (!string.IsNullOrWhiteSpace(next_href))
        {
            pathOrUrl = next_href;
        }
        else if (!string.IsNullOrWhiteSpace(id))
        {
            limit = Math.Clamp(limit, 1, 200);
            var encoded = Uri.EscapeDataString(id);
            pathOrUrl = $"playlists/{encoded}/tracks?linked_partitioning=true&limit={limit}&access=playable,preview,blocked";
            if (!string.IsNullOrWhiteSpace(cursor))
            {
                pathOrUrl += $"&cursor={Uri.EscapeDataString(cursor)}";
            }
        }
        else
        {
            return BadRequest(new { error = "missing_id_or_next_href" });
        }

        var (status, json) = await api.GetAsync(HttpContext, pathOrUrl);
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Basic proxy helper to unify error handling.
    /// </summary>
    private IActionResult ProxyJson(HttpStatusCode status, JsonDocument? json, bool allowEmptyOk = false)
    {
        if (status == HttpStatusCode.Unauthorized)
        {
            return Unauthorized(new { error = "soundcloud_not_authenticated" });
        }

        if (allowEmptyOk && (status == HttpStatusCode.NoContent || json is null) && (int)status >= 200 && (int)status < 300)
        {
            return Ok(new { ok = true });
        }

        if (json is null)
        {
            return StatusCode((int)status, new { error = "soundcloud_error", status = (int)status });
        }

        return StatusCode(
            (int)status,
            JsonSerializer.Deserialize<object>(json.RootElement.GetRawText(), new JsonSerializerOptions(JsonSerializerDefaults.Web))!);
    }
}
