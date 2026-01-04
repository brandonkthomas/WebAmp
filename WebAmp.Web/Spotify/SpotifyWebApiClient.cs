using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;

namespace WebAmp.Web.Spotify;

// ============================================================================================
/// <summary>
/// Client for the Spotify Web API.
/// </summary>
public sealed class SpotifyWebApiClient
{
    // ============================================================================================
    // Private values
    // ============================================================================================

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly SpotifyAuthService _auth;
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    // ============================================================================================
    /// <summary>
    /// Initializes the Spotify web API client.
    /// </summary>
    /// <param name="httpClientFactory">The HTTP client factory.</param>
    /// <param name="auth">The Spotify authentication service.</param>
    public SpotifyWebApiClient(IHttpClientFactory httpClientFactory, SpotifyAuthService auth)
    {
        _httpClientFactory = httpClientFactory;
        _auth = auth;
    }

    // ============================================================================================
    /// <summary>
    /// Sends a GET request to the Spotify API.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    /// <param name="pathAndQuery">The path and query to send the request to.</param>
    /// <returns>The status code and JSON response.</returns>
    public async Task<(HttpStatusCode status, JsonDocument? json)> GetAsync(HttpContext ctx, string pathAndQuery)
    {
        var token = await _auth.GetValidAccessTokenAsync(ctx);
        if (string.IsNullOrWhiteSpace(token)) return (HttpStatusCode.Unauthorized, null);

        var client = _httpClientFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Get, $"https://api.spotify.com/v1/{pathAndQuery.TrimStart('/')}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(body)) return (resp.StatusCode, null);
        return (resp.StatusCode, TryParseJson(body));
    }

    // ============================================================================================
    /// <summary>
    /// Sends a PUT request to the Spotify API.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    /// <param name="pathAndQuery">The path and query to send the request to.</param>
    /// <param name="payload">The payload to send with the request.</param>
    /// <returns>The status code and JSON response.</returns>
    public async Task<(HttpStatusCode status, JsonDocument? json)> PutJsonAsync(HttpContext ctx, string pathAndQuery, object? payload)
    {
        var token = await _auth.GetValidAccessTokenAsync(ctx);
        if (string.IsNullOrWhiteSpace(token)) return (HttpStatusCode.Unauthorized, null);

        var client = _httpClientFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Put, $"https://api.spotify.com/v1/{pathAndQuery.TrimStart('/')}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (payload is not null)
        {
            var json = JsonSerializer.Serialize(payload, JsonOpts);
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }
        using var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(body)) return (resp.StatusCode, null);
        return (resp.StatusCode, TryParseJson(body));
    }

    // ============================================================================================
    /// <summary>
    /// Sends a POST request to the Spotify API.
    /// </summary>
    /// <param name="ctx">The HTTP context.</param>
    /// <param name="pathAndQuery">The path and query to send the request to.</param>
    /// <param name="payload">The payload to send with the request.</param>
    /// <returns>The status code and JSON response.</returns>
    public async Task<(HttpStatusCode status, JsonDocument? json)> PostJsonAsync(
        HttpContext ctx, string pathAndQuery,
        object? payload)
    {
        var token = await _auth.GetValidAccessTokenAsync(ctx);
        if (string.IsNullOrWhiteSpace(token)) return (HttpStatusCode.Unauthorized, null);

        var client = _httpClientFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Post, $"https://api.spotify.com/v1/{pathAndQuery.TrimStart('/')}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (payload is not null)
        {
            var json = JsonSerializer.Serialize(payload, JsonOpts);
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }
        using var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(body)) return (resp.StatusCode, null);
        return (resp.StatusCode, TryParseJson(body));
    }

    // ============================================================================================
    /// <summary>
    /// Tries to parse the JSON body of the response.
    /// </summary>
    /// <param name="body">The body of the response.</param>
    /// <returns>The JSON document or null if the body is not valid JSON.</returns>
    private static JsonDocument? TryParseJson(string body)
    {
        try
        {
            return JsonDocument.Parse(body);
        }
        catch (JsonException)
        {
            // Spotify API sometimes returns empty or non-JSON bodies (e.g., "device not found")
            // We will treat this as "no json" and rely on the HTTP status code
            return null;
        }
    }
}
