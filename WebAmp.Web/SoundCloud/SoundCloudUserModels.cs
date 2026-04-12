using System.Text.Json.Serialization;

namespace WebAmp.Web.SoundCloud;

/// <summary>
/// Token response from the SoundCloud OAuth token endpoint for the
/// Authorization Code flow.
/// </summary>
public sealed class SoundCloudUserTokenResponse
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

/// <summary>
/// Authentication ticket persisted in an encrypted cookie for SoundCloud
/// user sessions.
/// </summary>
public sealed class SoundCloudUserAuthTicket
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
