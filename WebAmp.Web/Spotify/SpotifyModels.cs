using System.Text.Json.Serialization;

namespace WebAmp.Web.Spotify;

// ============================================================================================
/// <summary>
/// Represents the response from the Spotify token endpoint.
/// </summary>
public sealed class SpotifyTokenResponse
{
    [JsonPropertyName("access_token")]
    public string AccessToken { get; set; } = "";

    [JsonPropertyName("token_type")]
    public string TokenType { get; set; } = "";

    [JsonPropertyName("expires_in")]
    public int ExpiresIn { get; set; }

    [JsonPropertyName("refresh_token")]
    public string? RefreshToken { get; set; }

    [JsonPropertyName("scope")]
    public string? Scope { get; set; }
}

// ============================================================================================
/// <summary>
/// Represents the error response from the Spotify token endpoint.
/// </summary>
public sealed class SpotifyErrorResponse
{
    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("error_description")]
    public string? ErrorDescription { get; set; }
}

// ============================================================================================
/// <summary>
/// Represents the authentication ticket for the Spotify authentication service.
/// </summary>
public sealed class SpotifyAuthTicket
{
    public string AccessToken { get; set; } = "";
    public string RefreshToken { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
    public string? Scope { get; set; }

    public bool IsExpiredOrNearExpiry(TimeSpan? skew = null)
    {
        var s = skew ?? TimeSpan.FromMinutes(2);
        return DateTimeOffset.UtcNow >= (ExpiresAt - s);
    }
}
