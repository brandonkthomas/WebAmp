using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using WebAmp.Web.Spotify;

namespace WebAmp.Web.Controllers;

public sealed class WebAmpSpotifyApiController(SpotifyAuthService auth, SpotifyWebApiClient api) : ControllerBase
{
    // ============================================================================================
    /// <summary>
    /// Checks if the user is authenticated and returns their profile.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Status()
    {
        var token = await auth.GetValidAccessTokenAsync(HttpContext);
        if (string.IsNullOrWhiteSpace(token))
        {
            return Ok(new { isAuthenticated = false });
        }

        // Best-effort profile fetch (also returns product=premium if user is Premium)
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
    /// Logs out the user by clearing the authentication ticket.
    /// </summary>
    [HttpPost]
    public IActionResult Logout()
    {
        auth.ClearTicket(HttpContext);
        return Ok(new { ok = true });
    }

    // ============================================================================================
    /// <summary>
    /// Returns the access token for the authenticated user.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> AccessToken()
    {
        var token = await auth.GetValidAccessTokenAsync(HttpContext);
        if (string.IsNullOrWhiteSpace(token)) return Unauthorized(new { error = "not_authenticated" });
        return Ok(new { accessToken = token });
    }

    // ============================================================================================
    /// <summary>
    /// Searches for tracks, artists, albums, or playlists.
    /// </summary>
    /// <param name="q">The query string to search for.</param>
    /// <param name="type">The type of content to search for (track, artist, album, playlist).</param>
    /// <param name="limit">The maximum number of results to return (1-50).</param>
    /// <param name="offset">The offset to start returning results from (0-).</param>
    [HttpGet]
    public async Task<IActionResult> Search(
        [FromQuery] string q, 
        [FromQuery] string? type = null, 
        [FromQuery] int limit = 10, 
        [FromQuery] int offset = 0)
    {
        if (string.IsNullOrWhiteSpace(q)) return BadRequest(new { error = "missing_q" });
        limit = Math.Clamp(limit, 1, 50);
        offset = Math.Max(0, offset);
        var types = string.IsNullOrWhiteSpace(type) ? "track,artist,album,playlist" : type!;
        var path = $"search?q={Uri.EscapeDataString(q)}&type={Uri.EscapeDataString(types)}&limit={limit}&offset={offset}";
        var (status, json) = await api.GetAsync(HttpContext, path);
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the user's playlists.
    /// </summary>
    /// <param name="limit">The maximum number of results to return (1-50).</param>
    /// <param name="offset">The offset to start returning results from (0-).</param>
    [HttpGet]
    public async Task<IActionResult> MyPlaylists([FromQuery] int limit = 20, [FromQuery] int offset = 0)
    {
        limit = Math.Clamp(limit, 1, 50);
        offset = Math.Max(0, offset);
        var (status, json) = await api.GetAsync(HttpContext, $"me/playlists?limit={limit}&offset={offset}");
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the tracks for a playlist.
    /// </summary>
    /// <param name="id">The ID of the playlist.</param>
    /// <param name="limit">The maximum number of results to return (1-100).</param>
    /// <param name="offset">The offset to start returning results from (0-).</param>
    [HttpGet]
    public async Task<IActionResult> PlaylistTracks([FromQuery] string id, [FromQuery] int limit = 100, [FromQuery] int offset = 0)
    {
        if (string.IsNullOrWhiteSpace(id)) return BadRequest(new { error = "missing_id" });
        limit = Math.Clamp(limit, 1, 100);
        offset = Math.Max(0, offset);
        var (status, json) = await api.GetAsync(HttpContext, $"playlists/{Uri.EscapeDataString(id)}/tracks?limit={limit}&offset={offset}");
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the details of a playlist.
    /// </summary>
    /// <param name="id">The ID of the playlist.</param>
    [HttpGet]
    public async Task<IActionResult> Playlist([FromQuery] string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return BadRequest(new { error = "missing_id" });
        var (status, json) = await api.GetAsync(HttpContext, $"playlists/{Uri.EscapeDataString(id)}");
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the user's saved tracks.
    /// </summary>
    /// <param name="limit">The maximum number of results to return (1-50).</param>
    /// <param name="offset">The offset to start returning results from (0-).</param>
    [HttpGet]
    public async Task<IActionResult> SavedTracks([FromQuery] int limit = 20, [FromQuery] int offset = 0)
    {
        limit = Math.Clamp(limit, 1, 50);
        offset = Math.Max(0, offset);
        var (status, json) = await api.GetAsync(HttpContext, $"me/tracks?limit={limit}&offset={offset}");
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the user's saved albums.
    /// </summary>
    /// <param name="limit">The maximum number of results to return (1-50).</param>
    /// <param name="offset">The offset to start returning results from (0-).</param>
    [HttpGet]
    public async Task<IActionResult> SavedAlbums([FromQuery] int limit = 20, [FromQuery] int offset = 0)
    {
        limit = Math.Clamp(limit, 1, 50);
        offset = Math.Max(0, offset);
        var (status, json) = await api.GetAsync(HttpContext, $"me/albums?limit={limit}&offset={offset}");
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the tracks for an album.
    /// </summary>
    /// <param name="id">The ID of the album.</param>
    /// <param name="limit">The maximum number of results to return (1-50).</param>
    /// <param name="offset">The offset to start returning results from (0-).</param>
    [HttpGet]
    public async Task<IActionResult> AlbumTracks([FromQuery] string id, [FromQuery] int limit = 50, [FromQuery] int offset = 0)
    {
        if (string.IsNullOrWhiteSpace(id)) return BadRequest(new { error = "missing_id" });
        limit = Math.Clamp(limit, 1, 50);
        offset = Math.Max(0, offset);
        var (status, json) = await api.GetAsync(HttpContext, $"albums/{Uri.EscapeDataString(id)}/tracks?limit={limit}&offset={offset}");
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the details of an album.
    /// </summary>
    /// <param name="id">The ID of the album.</param>
    [HttpGet]
    public async Task<IActionResult> Album([FromQuery] string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return BadRequest(new { error = "missing_id" });
        var (status, json) = await api.GetAsync(HttpContext, $"albums/{Uri.EscapeDataString(id)}");
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the user's followed artists.
    /// </summary>
    /// <param name="limit">The maximum number of results to return (1-50).</param>
    /// <param name="after">The cursor to start returning results from.</param>
    [HttpGet]
    public async Task<IActionResult> FollowedArtists([FromQuery] int limit = 20, [FromQuery] string? after = null)
    {
        limit = Math.Clamp(limit, 1, 50);
        var path = $"me/following?type=artist&limit={limit}";
        if (!string.IsNullOrWhiteSpace(after)) path += $"&after={Uri.EscapeDataString(after)}";
        var (status, json) = await api.GetAsync(HttpContext, path);
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the top tracks for an artist.
    /// </summary>
    /// <param name="id">The ID of the artist.</param>
    /// <param name="market">The market to return the tracks for (US, GB, etc.).</param>
    [HttpGet]
    public async Task<IActionResult> ArtistTopTracks([FromQuery] string id, [FromQuery] string market = "US")
    {
        if (string.IsNullOrWhiteSpace(id)) return BadRequest(new { error = "missing_id" });
        if (string.IsNullOrWhiteSpace(market)) market = "US";
        var (status, json) = await api.GetAsync(HttpContext, $"artists/{Uri.EscapeDataString(id)}/top-tracks?market={Uri.EscapeDataString(market)}");
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the details of an artist.
    /// </summary>
    /// <param name="id">The ID of the artist.</param>
    [HttpGet]
    public async Task<IActionResult> Artist([FromQuery] string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return BadRequest(new { error = "missing_id" });
        var (status, json) = await api.GetAsync(HttpContext, $"artists/{Uri.EscapeDataString(id)}");
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns the albums for an artist.
    /// </summary>
    /// <param name="id">The ID of the artist.</param>
    /// <param name="includeGroups">The groups to include in the results (album, single, etc.).</param>
    /// <param name="limit">The maximum number of results to return (1-50).</param>
    /// <param name="offset">The offset to start returning results from (0-).</param>
    [HttpGet]
    public async Task<IActionResult> ArtistAlbums(
        [FromQuery] string id,
        [FromQuery] string? includeGroups = null,
        [FromQuery] int limit = 50,
        [FromQuery] int offset = 0)
    {
        if (string.IsNullOrWhiteSpace(id)) return BadRequest(new { error = "missing_id" });
        limit = Math.Clamp(limit, 1, 50);
        offset = Math.Max(0, offset);
        var groups = string.IsNullOrWhiteSpace(includeGroups) ? "album,single" : includeGroups!;
        var path = $"artists/{Uri.EscapeDataString(id)}/albums?include_groups={Uri.EscapeDataString(groups)}&limit={limit}&offset={offset}";
        var (status, json) = await api.GetAsync(HttpContext, path);
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Transfers playback to a different device.
    /// </summary>
    /// <param name="deviceId">The ID of the device to transfer playback to.</param>
    /// <param name="play">Whether to play the transfer.</param>
    public sealed class TransferPlaybackRequest
    {
        public string? DeviceId { get; set; }
        public bool Play { get; set; } = true;
    }

    // ============================================================================================
    /// <summary>
    /// Transfers playback to a different device.
    /// </summary>
    /// <param name="req">The request body.</param>
    [HttpPost]
    public async Task<IActionResult> Transfer([FromBody] TransferPlaybackRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.DeviceId)) return BadRequest(new { error = "missing_device_id" });
        var (status, json) = await api.PutJsonAsync(HttpContext, "me/player", new { device_ids = new[] { req.DeviceId }, play = req.Play });
        return ProxyJson(status, json, allowEmptyOk: true);
    }

    // ============================================================================================
    /// <summary>
    /// Plays a track or playlist.
    /// </summary>
    /// <param name="deviceId">The ID of the device to play the track or playlist on.</param>
    /// <param name="trackUri">The URI of the track to play.</param>
    /// <param name="uris">The URIs of the tracks to play.</param>
    /// <param name="positionMs">The position to start playing the track or playlist at.</param>
    public sealed class PlayRequest
    {
        public string? DeviceId { get; set; }
        public string? TrackUri { get; set; }
        public string[]? Uris { get; set; }
        public int? PositionMs { get; set; }
    }

    // ============================================================================================
    /// <summary>
    /// Plays a track or playlist.
    /// </summary>
    /// <param name="req">The request body.</param>
    [HttpPost]
    public async Task<IActionResult> Play([FromBody] PlayRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.DeviceId)) return BadRequest(new { error = "missing_device_id" });

        object payload;
        if (!string.IsNullOrWhiteSpace(req.TrackUri))
        {
            payload = new { uris = new[] { req.TrackUri }, position_ms = req.PositionMs };
        }
        else if (req.Uris is { Length: > 0 })
        {
            payload = new { uris = req.Uris, position_ms = req.PositionMs };
        }
        else
        {
            return BadRequest(new { error = "missing_track_uri" });
        }

        var (status, json) = await api.PutJsonAsync(HttpContext, $"me/player/play?device_id={Uri.EscapeDataString(req.DeviceId)}", payload);
        return ProxyJson(status, json, allowEmptyOk: true);
    }

    // ============================================================================================
    /// <summary>
    /// Seeks to a specific position in a track or playlist.
    /// </summary>
    /// <param name="deviceId">The ID of the device to seek on.</param>
    /// <param name="positionMs">The position to seek to.</param>
    public sealed class SeekRequest
    {
        public string? DeviceId { get; set; }
        public int PositionMs { get; set; }
    }

    // ============================================================================================
    /// <summary>
    /// Seeks to a specific position in a track or playlist.
    /// </summary>
    /// <param name="req">The request body.</param>
    [HttpPost]
    public async Task<IActionResult> Seek([FromBody] SeekRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.DeviceId)) return BadRequest(new { error = "missing_device_id" });
        var pos = Math.Max(0, req.PositionMs);
        var (status, json) = await api.PutJsonAsync(HttpContext, $"me/player/seek?device_id={Uri.EscapeDataString(req.DeviceId)}&position_ms={pos}", payload: null);
        return ProxyJson(status, json, allowEmptyOk: true);
    }

    // ============================================================================================
    /// <summary>
    /// Pauses playback on a device.
    /// </summary>
    /// <param name="deviceId">The ID of the device to pause playback on.</param>
    public sealed class DeviceRequest
    {
        public string? DeviceId { get; set; }
    }

    // ============================================================================================
    /// <summary>
    /// Pauses playback on a device.
    /// </summary>
    /// <param name="req">The request body.</param>
    [HttpPost]
    public async Task<IActionResult> Pause([FromBody] DeviceRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.DeviceId)) return BadRequest(new { error = "missing_device_id" });
        var (status, json) = await api.PutJsonAsync(HttpContext, $"me/player/pause?device_id={Uri.EscapeDataString(req.DeviceId)}", payload: null);
        return ProxyJson(status, json, allowEmptyOk: true);
    }

    // ============================================================================================
    /// <summary>
    /// Resumes playback on a device.
    /// </summary>
    /// <param name="req">The request body.</param>
    [HttpPost]
    public async Task<IActionResult> Resume([FromBody] DeviceRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.DeviceId)) return BadRequest(new { error = "missing_device_id" });
        var (status, json) = await api.PutJsonAsync(HttpContext, $"me/player/play?device_id={Uri.EscapeDataString(req.DeviceId)}", payload: null);
        return ProxyJson(status, json, allowEmptyOk: true);
    }

    // ============================================================================================
    /// <summary>
    /// Skips to the next track in the playlist.
    /// </summary>
    /// <param name="req">The request body.</param>
    [HttpPost]
    public async Task<IActionResult> Next([FromBody] DeviceRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.DeviceId)) return BadRequest(new { error = "missing_device_id" });
        var (status, json) = await api.PostJsonAsync(HttpContext, $"me/player/next?device_id={Uri.EscapeDataString(req.DeviceId)}", payload: null);
        return ProxyJson(status, json, allowEmptyOk: true);
    }

    // ============================================================================================
    /// <summary>
    /// Skips to the previous track in the playlist.
    /// </summary>
    /// <param name="req">The request body.</param>
    [HttpPost]
    public async Task<IActionResult> Previous([FromBody] DeviceRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.DeviceId)) return BadRequest(new { error = "missing_device_id" });
        var (status, json) = await api.PostJsonAsync(HttpContext, $"me/player/previous?device_id={Uri.EscapeDataString(req.DeviceId)}", payload: null);
        return ProxyJson(status, json, allowEmptyOk: true);
    }

    private IActionResult ProxyJson(HttpStatusCode status, JsonDocument? json, bool allowEmptyOk = false)
    {
        if (status == HttpStatusCode.Unauthorized) return Unauthorized(new { error = "not_authenticated" });
        if (allowEmptyOk && (status == HttpStatusCode.NoContent || json is null) && (int)status >= 200 && (int)status < 300)
        {
            return Ok(new { ok = true });
        }
        if (json is null) return StatusCode((int)status, new { error = "spotify_error", status = (int)status });
        return StatusCode((int)status, JsonSerializer.Deserialize<object>(json.RootElement.GetRawText(), new JsonSerializerOptions(JsonSerializerDefaults.Web))!);
    }
}
