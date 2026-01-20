namespace WebAmp.Web.SoundCloud;

/// <summary>
/// Configuration options for the SoundCloud API integration.
/// </summary>
public sealed class SoundCloudOptions
{
    /// <summary>
    /// OAuth client id for the SoundCloud application.
    /// </summary>
    public string? ClientId { get; init; }

    /// <summary>
    /// OAuth client secret for the SoundCloud application.
    /// </summary>
    public string? ClientSecret { get; init; }

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

    /// <summary>
    /// Redirect URI for the SoundCloud Authorization Code flow.
    /// Must be registered in the SoundCloud developer dashboard.
    /// Example: https://brandonthomas.net/webamp/soundcloud/callback
    /// </summary>
    public string? RedirectUri { get; init; }

    /// <summary>
    /// Whether to require HTTPS when setting auth cookies (recommended true in prod).
    /// </summary>
    public bool RequireSecureCookies { get; init; } = true;
}
