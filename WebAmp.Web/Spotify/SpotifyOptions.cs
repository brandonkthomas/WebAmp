namespace WebAmp.Web.Spotify;

// ============================================================================================
/// <summary>
/// Represents the options for the Spotify authentication service.
/// </summary>
public sealed class SpotifyOptions
{
    // ============================================================================================
    // Required properties
    // ============================================================================================

    public string? ClientId { get; init; }
    public string? ClientSecret { get; init; }

    /// <summary>
    /// Must match a Redirect URI configured in the Spotify developer dashboard.
    /// Example: https://brandonthomas.net/webamp/spotify/callback
    /// </summary>
    public string? RedirectUri { get; init; }

    /// <summary>
    /// Whether to require HTTPS when setting cookies (recommended true in prod).
    /// </summary>
    public bool RequireSecureCookies { get; init; } = true;

    // ============================================================================================
    // Optional properties
    // ============================================================================================

    /// <summary>
    /// Space-delimited scopes. If empty, defaults will be used.
    /// </summary>
    public string? Scopes { get; init; }

    /// <summary>
    /// Optional file path for ClientId. If ClientId is empty, we will read this file and use its contents.
    /// Useful for Docker bind-mount secrets on plain docker (non-swarm).
    /// </summary>
    public string? ClientIdFile { get; init; }

    /// <summary>
    /// Optional file path for ClientSecret. If ClientSecret is empty, we will read this file and use its contents.
    /// Useful for Docker bind-mount secrets on plain docker (non-swarm).
    /// </summary>
    public string? ClientSecretFile { get; init; }
}
