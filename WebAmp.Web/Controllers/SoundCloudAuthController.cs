using Microsoft.AspNetCore.Mvc;
using WebAmp.Web.SoundCloud;

namespace WebAmp.Web.Controllers;

// ============================================================================================
/// <summary>
/// OAuth endpoints for SoundCloud user sign-in (Authorization Code + PKCE).
/// </summary>
public sealed class SoundCloudAuthController(SoundCloudUserAuthService auth) : Controller
{
    // ============================================================================================
    /// <summary>
    /// Redirects to SoundCloud for authentication.
    /// </summary>
    [HttpGet("/webamp/soundcloud/login")]
    public IActionResult Login([FromQuery] string? returnUrl = null)
    {
        var safeReturn = (!string.IsNullOrWhiteSpace(returnUrl) && Url.IsLocalUrl(returnUrl))
            ? returnUrl!
            : "/webamp";

        var url = auth.GetAuthorizeUrl(HttpContext, safeReturn);
        return Redirect(url);
    }

    // ============================================================================================
    /// <summary>
    /// Handles the callback from SoundCloud after authentication.
    /// Must be configured as a Redirect URI in the SoundCloud developer dashboard.
    /// </summary>
    [HttpGet("/webamp/soundcloud/callback")]
    public async Task<IActionResult> Callback(
        [FromQuery] string? code,
        [FromQuery] string? state,
        [FromQuery] string? error)
    {
        var (ok, err) = await auth.HandleCallbackAsync(HttpContext, code, state, error);
        var returnUrl = auth.ConsumeReturnUrl(HttpContext, fallback: "/webamp");

        if (!ok)
        {
            var safe = Url.IsLocalUrl(returnUrl) ? returnUrl : "/webamp";
            var sep = safe.Contains('?') ? "&" : "?";
            return Redirect($"{safe}{sep}soundcloudError={Uri.EscapeDataString(err ?? "auth_failed")}");
        }

        return Redirect(returnUrl);
    }
}
