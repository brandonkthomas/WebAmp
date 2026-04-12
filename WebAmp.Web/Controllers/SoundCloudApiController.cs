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
        var candidates = new List<SoundCloudStreamCandidateDto>();

        if (streamsStatus == HttpStatusCode.Unauthorized)
        {
            // Treat upstream auth failures on the streams sub-resource as
            // "not streamable" for this track rather than a global auth error.
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "track_not_streamable" });
        }

        if (streamsStatus == HttpStatusCode.OK && streamsJson is not null)
        {
            var streamsRoot = streamsJson.RootElement;

            string? TryString(string name)
                => streamsRoot.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String
                    ? p.GetString()
                    : null;

            var rawCandidates = new[]
            {
                new SoundCloudStreamCandidateSpec("http_mp3_128", TryString("http_mp3_128_url"), "progressive", "audio/mpeg"),
                new SoundCloudStreamCandidateSpec("hls_aac_160", TryString("hls_aac_160_url"), "hls", "application/vnd.apple.mpegurl"),
                new SoundCloudStreamCandidateSpec("hls_aac_96", TryString("hls_aac_96_url"), "hls", "application/vnd.apple.mpegurl"),
                new SoundCloudStreamCandidateSpec("hls_mp3_128", TryString("hls_mp3_128_url"), "hls", "application/vnd.apple.mpegurl"),
                new SoundCloudStreamCandidateSpec("hls_opus_64", TryString("hls_opus_64_url"), "hls", "application/vnd.apple.mpegurl"),
                new SoundCloudStreamCandidateSpec("preview_mp3_128", TryString("preview_mp3_128_url"), "progressive", "audio/mpeg", true)
            };

            foreach (var rawCandidate in rawCandidates)
            {
                var resolvedCandidate = await TryResolveStreamCandidateAsync(rawCandidate, cancellationToken);
                if (resolvedCandidate is null)
                {
                    continue;
                }

                if (candidates.Any(existing => string.Equals(existing.Url, resolvedCandidate.Url, StringComparison.Ordinal)))
                {
                    continue;
                }

                candidates.Add(resolvedCandidate);
            }
        }

        if (candidates.Count == 0)
        {
            // As a last resort, treat the track as not streamable.
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "track_not_streamable" });
        }

        var permalinkUrl = root.TryGetProperty("permalink_url", out var permalinkProp) && permalinkProp.ValueKind == JsonValueKind.String
            ? permalinkProp.GetString()
            : null;

        var primary = candidates[0];

        return Ok(new
        {
            url = primary.Url,
            kind = primary.Kind,
            transport = primary.Transport,
            mimeType = primary.MimeType,
            isPreview = primary.IsPreview,
            candidates,
            // Helpful for attribution in the UI.
            permalinkUrl
        });
    }

    /// <summary>
    /// Attempt to resolve a stream candidate URL to a final streaming URL.
    /// </summary>
    /// <param name="candidate">The candidate stream URL to resolve.</param>
    /// <param name="cancellationToken">A cancellation token.</param>
    /// <returns>The resolved stream candidate or null if the resolution failed.</returns>
    private async Task<SoundCloudStreamCandidateDto?> TryResolveStreamCandidateAsync(
        SoundCloudStreamCandidateSpec candidate,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(candidate.Url))
        {
            return null;
        }

        var resolvedUrl = await TryResolveStreamUrlAsync(candidate.Url, cancellationToken);
        if (string.IsNullOrWhiteSpace(resolvedUrl))
        {
            return null;
        }

        return new SoundCloudStreamCandidateDto(
            candidate.Kind,
            resolvedUrl,
            candidate.Transport,
            candidate.MimeType,
            candidate.IsPreview);
    }

    /// <summary>
    /// Attempt to resolve a stream URL to a final streaming URL.
    /// </summary>
    /// <param name="candidateUrl">The stream URL to resolve.</param>
    /// <param name="cancellationToken">A cancellation token.</param>
    /// <returns>The resolved stream URL or null if the resolution failed.</returns>
    private async Task<string?> TryResolveStreamUrlAsync(string candidateUrl, CancellationToken cancellationToken)
    {
        // For some responses, the *_url fields from /streams are not the final
        // CDN URLs but intermediate API endpoints under api.soundcloud.com
        // which require an Authorization header and return a small JSON body
        // containing the actual streaming URL. Hitting those directly from the
        // browser (e.g. as an <audio> src) will 401 because the OAuth token is
        // not attached. Resolve those server-side first.
        if (!Uri.TryCreate(candidateUrl, UriKind.Absolute, out var parsed) ||
            !string.Equals(parsed.Host, "api.soundcloud.com", StringComparison.OrdinalIgnoreCase))
        {
            return candidateUrl;
        }

        var (resolveStatus, resolveJson, resolveFinalUri, _resolveMediaType) =
            await GetMetaWithUserOrAppAsync(candidateUrl, cancellationToken);

        if (resolveStatus == HttpStatusCode.Unauthorized)
        {
            return null;
        }

        if (resolveStatus != HttpStatusCode.OK || resolveJson is null)
        {
            if (resolveStatus == HttpStatusCode.OK && resolveJson is null)
            {
                if (resolveFinalUri is not null &&
                    !string.Equals(resolveFinalUri.Host, "api.soundcloud.com", StringComparison.OrdinalIgnoreCase))
                {
                    return resolveFinalUri.ToString();
                }

                return candidateUrl;
            }

            return null;
        }

        var resolveRoot = resolveJson.RootElement;
        if (!resolveRoot.TryGetProperty("url", out var urlProp) ||
            urlProp.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(urlProp.GetString()))
        {
            return null;
        }

        return urlProp.GetString()!;
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

    private async Task<(HttpStatusCode status, JsonDocument? json, Uri? finalUri, string? mediaType)> GetMetaWithUserOrAppAsync(
        string pathOrUrl,
        CancellationToken cancellationToken)
    {
        var (status, json, finalUri, mediaType) = await userApi.GetMetaAsync(HttpContext, pathOrUrl, cancellationToken);
        if (status != HttpStatusCode.Unauthorized)
        {
            return (status, json, finalUri, mediaType);
        }

        return await api.GetMetaAsync(pathOrUrl, cancellationToken);
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

    private sealed record SoundCloudStreamCandidateSpec(
        string Kind,
        string? Url,
        string Transport,
        string MimeType,
        bool IsPreview = false);

    private sealed record SoundCloudStreamCandidateDto(
        string Kind,
        string Url,
        string Transport,
        string MimeType,
        bool IsPreview);
}
