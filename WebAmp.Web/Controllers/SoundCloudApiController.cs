using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using WebAmp.Web.SoundCloud;

namespace WebAmp.Web.Controllers;

// ============================================================================================
/// <summary>
/// JSON proxy endpoints for SoundCloud search and streaming.
/// </summary>
public sealed class SoundCloudApiController(
    SoundCloudAuthService auth,
    SoundCloudApiClient api,
    SoundCloudUserApiClient userApi) : ControllerBase
{
    // ============================================================================================
    /// <summary>
    /// Returns basic status information for the SoundCloud integration.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Status(CancellationToken cancellationToken)
    {
        var isConfigured = auth.IsConfigured;
        if (!isConfigured)
        {
            return Ok(new { isConfigured = false, isAuthenticated = false });
        }

        // Best-effort token probe so the frontend can distinguish "configured but failing"
        // from "fully usable". We do not hit any resource endpoints here to stay cheap.
        var token = await auth.GetAccessTokenAsync(cancellationToken);
        var ok = !string.IsNullOrWhiteSpace(token);

        return Ok(new { isConfigured = true, isAuthenticated = ok });
    }

    // ============================================================================================
    /// <summary>
    /// Searches for playable public SoundCloud tracks.
    /// </summary>
    /// <param name="q">Free text query.</param>
    /// <param name="limit">Number of items to return (1-50).</param>
    /// <param name="cursor">
    /// Optional pagination cursor (see SoundCloud <c>linked_partitioning</c> docs).
    /// </param>
    [HttpGet]
    public async Task<IActionResult> SearchTracks(
        [FromQuery] string q,
        [FromQuery] int limit = 20,
        [FromQuery] string? cursor = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(q))
        {
            return BadRequest(new { error = "missing_q" });
        }

        limit = Math.Clamp(limit, 1, 50);

        var path = $"tracks?q={Uri.EscapeDataString(q)}&limit={limit}&access=playable,preview,blocked&linked_partitioning=true";
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            path += $"&cursor={Uri.EscapeDataString(cursor)}";
        }

        // Use user-scoped token when available (for consistency with other
        // user flows), falling back to app-level client credentials so that
        // public searches still work without an authenticated session.
        var (status, json) = await GetWithUserOrAppAsync(path, cancellationToken);
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Searches public SoundCloud playlists.
    /// </summary>
    /// <param name="q">Free text query.</param>
    /// <param name="limit">Number of items to return (1-50).</param>
    /// <param name="cursor">
    /// Optional pagination cursor (see SoundCloud <c>linked_partitioning</c> docs).
    /// </param>
    [HttpGet]
    public async Task<IActionResult> SearchPlaylists(
        [FromQuery] string q,
        [FromQuery] int limit = 20,
        [FromQuery] string? cursor = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(q))
        {
            return BadRequest(new { error = "missing_q" });
        }

        limit = Math.Clamp(limit, 1, 50);

        var path = $"playlists?q={Uri.EscapeDataString(q)}&limit={limit}&linked_partitioning=true";
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            path += $"&cursor={Uri.EscapeDataString(cursor)}";
        }

        var (status, json) = await GetWithUserOrAppAsync(path, cancellationToken);
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Searches public SoundCloud users (artists).
    /// </summary>
    /// <param name="q">Free text query.</param>
    /// <param name="limit">Number of items to return (1-50).</param>
    /// <param name="cursor">
    /// Optional pagination cursor (see SoundCloud <c>linked_partitioning</c> docs).
    /// </param>
    [HttpGet]
    public async Task<IActionResult> SearchUsers(
        [FromQuery] string q,
        [FromQuery] int limit = 20,
        [FromQuery] string? cursor = null,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(q))
        {
            return BadRequest(new { error = "missing_q" });
        }

        limit = Math.Clamp(limit, 1, 50);

        var path = $"users?q={Uri.EscapeDataString(q)}&limit={limit}&linked_partitioning=true";
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            path += $"&cursor={Uri.EscapeDataString(cursor)}";
        }

        var (status, json) = await GetWithUserOrAppAsync(path, cancellationToken);
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Returns raw SoundCloud track metadata for a given id.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Track([FromQuery] string id, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return BadRequest(new { error = "missing_id" });
        }

        var (status, json) = await api.GetAsync($"tracks/{Uri.EscapeDataString(id)}", cancellationToken);
        return ProxyJson(status, json);
    }

    // ============================================================================================
    /// <summary>
    /// Resolves a direct stream URL for a track by following its <c>stream_url</c>
    /// descriptor and selecting a suitable transcoding.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Stream([FromQuery] string id, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return BadRequest(new { error = "missing_id" });
        }

        // Track metadata fetch – required to inspect access level and permalink URL.
        var encodedId = Uri.EscapeDataString(id);
        var (trackStatus, trackJson) = await GetWithUserOrAppAsync($"tracks/{encodedId}", cancellationToken);
        if (trackStatus == HttpStatusCode.NotFound)
        {
            return NotFound(new { error = "track_not_found" });
        }

        if (trackStatus == HttpStatusCode.Unauthorized)
        {
            // Even though this surfaces as 401 from the upstream API, from the
            // app's perspective we cannot stream this track (private or otherwise
            // restricted). Avoid leaking "not_authenticated" here since the user
            // may still have a valid SoundCloud session.
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "track_not_streamable" });
        }

        if (trackStatus != HttpStatusCode.OK || trackJson is null)
        {
            return ProxyJson(trackStatus, trackJson);
        }

        var root = trackJson.RootElement;

        // access = blocked / preview / playable semantics:
        // https://developers.soundcloud.com/docs/api/guide
        if (root.TryGetProperty("access", out var accessProp))
        {
            var accessVal = accessProp.GetString();
            if (string.Equals(accessVal, "blocked", StringComparison.OrdinalIgnoreCase))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { error = "track_not_streamable" });
            }
        }

        // Some private tracks can only be streamed when the caller provides the
        // per-track secret_token. If we have one on the metadata, include it
        // when calling /tracks/{id}/streams.
        string? secretToken = null;
        if (root.TryGetProperty("secret_token", out var secretProp) &&
            secretProp.ValueKind == JsonValueKind.String &&
            !string.IsNullOrWhiteSpace(secretProp.GetString()))
        {
            secretToken = secretProp.GetString();
        }

        // New-style streaming endpoint per public OpenAPI spec:
        //   GET /tracks/{track_id}/streams
        // See: https://developers.soundcloud.com/docs/api/explorer/open-api#/
        var streamsPath = $"tracks/{encodedId}/streams";
        if (!string.IsNullOrWhiteSpace(secretToken))
        {
            streamsPath += $"?secret_token={Uri.EscapeDataString(secretToken)}";
        }

        var (streamsStatus, streamsJson) = await GetWithUserOrAppAsync(streamsPath, cancellationToken);

        string? chosenUrl = null;
        string? chosenKind = null;

        if (streamsStatus == HttpStatusCode.Unauthorized)
        {
            // Treat upstream auth failures on the streams sub-resource as
            // "not streamable" for this track rather than a global auth error.
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "track_not_streamable" });
        }

        if (streamsStatus == HttpStatusCode.OK && streamsJson is not null)
        {
            var streamsRoot = streamsJson.RootElement;

            // Prefer modern AAC-based HLS streams when available, as recommended
            // by the SoundCloud streaming guidelines:
            // https://developers.soundcloud.com/blog/api-streaming-urls
            if (streamsRoot.TryGetProperty("hls_aac_160_url", out var hls160Prop) &&
                hls160Prop.ValueKind == JsonValueKind.String &&
                !string.IsNullOrWhiteSpace(hls160Prop.GetString()))
            {
                chosenUrl = hls160Prop.GetString();
                chosenKind = "hls_aac_160";
            }
            else if (streamsRoot.TryGetProperty("hls_aac_96_url", out var hls96Prop) &&
                     hls96Prop.ValueKind == JsonValueKind.String &&
                     !string.IsNullOrWhiteSpace(hls96Prop.GetString()))
            {
                chosenUrl = hls96Prop.GetString();
                chosenKind = "hls_aac_96";
            }
            else
            {
                // Legacy or preview fields (kept for compatibility while rollout completes).
                string? TryString(string name)
                    => streamsRoot.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String
                        ? p.GetString()
                        : null;

                chosenUrl = TryString("http_mp3_128_url")
                            ?? TryString("hls_mp3_128_url")
                            ?? TryString("hls_opus_64_url")
                            ?? TryString("preview_mp3_128_url");

                if (!string.IsNullOrWhiteSpace(chosenUrl))
                {
                    if (!string.IsNullOrWhiteSpace(TryString("http_mp3_128_url"))) chosenKind = "http_mp3_128";
                    else if (!string.IsNullOrWhiteSpace(TryString("hls_mp3_128_url"))) chosenKind = "hls_mp3_128";
                    else if (!string.IsNullOrWhiteSpace(TryString("hls_opus_64_url"))) chosenKind = "hls_opus_64";
                    else chosenKind = "preview_mp3_128";
                }
            }
        }

        if (string.IsNullOrWhiteSpace(chosenUrl))
        {
            // As a last resort, treat the track as not streamable.
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "track_not_streamable" });
        }

        // For some responses, the *_url fields from /streams are not the final
        // CDN URLs but intermediate API endpoints under api.soundcloud.com
        // which require an Authorization header and return a small JSON body
        // containing the actual streaming URL. Hitting those directly from the
        // browser (e.g. as an <audio> src) will 401 because the OAuth token is
        // not attached. Resolve those server-side first.
        string resolvedUrl = chosenUrl;
        if (Uri.TryCreate(chosenUrl, UriKind.Absolute, out var parsed) &&
            string.Equals(parsed.Host, "api.soundcloud.com", StringComparison.OrdinalIgnoreCase))
        {
            var (resolveStatus, resolveJson) = await GetWithUserOrAppAsync(chosenUrl, cancellationToken);
            if (resolveStatus == HttpStatusCode.Unauthorized)
            {
                // Same reasoning as above – if we cannot resolve the HLS URL
                // with any available token, treat this particular track as not
                // streamable rather than claiming the whole integration is
                // unauthenticated.
                return StatusCode(StatusCodes.Status403Forbidden, new { error = "track_not_streamable" });
            }

            if (resolveStatus != HttpStatusCode.OK || resolveJson is null)
            {
                return ProxyJson(resolveStatus, resolveJson);
            }

            var resolveRoot = resolveJson.RootElement;
            if (!resolveRoot.TryGetProperty("url", out var urlProp) ||
                urlProp.ValueKind != JsonValueKind.String ||
                string.IsNullOrWhiteSpace(urlProp.GetString()))
            {
                return StatusCode(StatusCodes.Status502BadGateway, new { error = "stream_resolution_failed" });
            }

            resolvedUrl = urlProp.GetString()!;
        }

        var permalinkUrl = root.TryGetProperty("permalink_url", out var permalinkProp) && permalinkProp.ValueKind == JsonValueKind.String
            ? permalinkProp.GetString()
            : null;

        return Ok(new
        {
            url = resolvedUrl,
            kind = chosenKind,
            // Helpful for attribution in the UI.
            permalinkUrl
        });
    }

    // ============================================================================================
    /// <summary>
    /// Attempts to call SoundCloud using a user-scoped token first (when the
    /// user is authenticated), falling back to the app-level client
    /// credentials token when no valid user token is present.
    /// </summary>
    private async Task<(HttpStatusCode status, JsonDocument? json)> GetWithUserOrAppAsync(
        string pathOrUrl,
        CancellationToken cancellationToken)
    {
        // Prefer the user-scoped token when available so that:
        // - private / liked tracks can be streamed
        // - per-user access controls are respected
        var (status, json) = await userApi.GetAsync(HttpContext, pathOrUrl);
        if (status != HttpStatusCode.Unauthorized)
        {
            return (status, json);
        }

        // If there is no valid user session, fall back to app-level auth,
        // which is sufficient for public, playable content.
        return await api.GetAsync(pathOrUrl, cancellationToken);
    }

    private IActionResult ProxyJson(HttpStatusCode status, JsonDocument? json)
    {
        if (status == HttpStatusCode.Unauthorized)
        {
            return Unauthorized(new { error = "soundcloud_not_authenticated" });
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
