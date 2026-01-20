using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Http;

namespace WebAmp.Web.SoundCloud;

/// <summary>
/// Client for user-scoped SoundCloud API calls (Authorization Code flow).
/// </summary>
public sealed class SoundCloudUserApiClient
{
    private static readonly Uri BaseUri = new("https://api.soundcloud.com/");
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly SoundCloudUserAuthService _auth;

    public SoundCloudUserApiClient(IHttpClientFactory httpClientFactory, SoundCloudUserAuthService auth)
    {
        _httpClientFactory = httpClientFactory;
        _auth = auth;
    }

        public async Task<(HttpStatusCode status, JsonDocument? json)> GetAsync(HttpContext ctx, string pathAndQuery)
    {
        var token = await _auth.GetValidAccessTokenAsync(ctx);
        if (string.IsNullOrWhiteSpace(token)) return (HttpStatusCode.Unauthorized, null);

        var client = _httpClientFactory.CreateClient();
            var uri = BuildUri(pathAndQuery);

        using var req = new HttpRequestMessage(HttpMethod.Get, uri);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.Accept.ParseAdd("application/json; charset=utf-8");

        using var resp = await client.SendAsync(req);
        var body = await resp.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(body)) return (resp.StatusCode, null);

        try
        {
            return (resp.StatusCode, JsonDocument.Parse(body));
        }
        catch (JsonException)
        {
            return (resp.StatusCode, null);
        }
    }

        private static Uri BuildUri(string pathOrUrl)
        {
            if (Uri.TryCreate(pathOrUrl, UriKind.Absolute, out var absolute))
            {
                return absolute;
            }

            var trimmed = pathOrUrl.TrimStart('/');
            return new Uri(BaseUri, trimmed);
        }
}
