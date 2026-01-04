using Microsoft.AspNetCore.Mvc;
using WebAmp.Web.Spotify;

namespace WebAmp.Web.Controllers;

// ============================================================================================
/// <summary>
/// OAuth endpoints for Spotify sign-in (Authorization Code + PKCE).
/// Mapped by the host app via conventional routes:
/// - /webamp/spotify/{action}
/// </summary>
public sealed class WebAmpSpotifyController(SpotifyAuthService auth) : Controller
{
    // ============================================================================================
    /// <summary>
    /// Redirects to Spotify for authentication.
    /// </summary>
    /// <param name="returnUrl">The URL to redirect to after authentication.</param>
    [HttpGet("/webamp/spotify/login")]
    public IActionResult Login([FromQuery] string? returnUrl = null)
    {
        // Default to WebAmp landing; only allow local return URLs.
        var safeReturn = (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl))
            ? returnUrl!
            : "/webamp";

        var url = auth.GetAuthorizeUrl(HttpContext, safeReturn);
        return Redirect(url);
    }

    // ============================================================================================
    /// <summary>
    /// Handles the callback from Spotify after authentication 
    /// -- must be configured as a Redirect URI in the Spotify developer dashboard
    /// </summary>
    /// <param name="code">The authorization code.</param>
    /// <param name="state">The state parameter.</param>
    /// <param name="error">The error parameter.</param>
    [HttpGet("/webamp/spotify/callback")]
    public async Task<IActionResult> Callback([FromQuery] string? code, [FromQuery] string? state, [FromQuery] string? error)
    {
        var (ok, err) = await auth.HandleCallbackAsync(HttpContext, code, state, error);
        var returnUrl = auth.ConsumeReturnUrl(HttpContext, fallback: "/webamp");

        if (!ok)
        {
            // For now: bounce back to WebAmp with a query param for the UI to display.
            var safe = Url.IsLocalUrl(returnUrl) ? returnUrl : "/webamp";
            var sep = safe.Contains('?') ? "&" : "?";
            return Redirect($"{safe}{sep}spotifyError={Uri.EscapeDataString(err ?? "auth_failed")}");
        }

        return Redirect(returnUrl);
    }
}
