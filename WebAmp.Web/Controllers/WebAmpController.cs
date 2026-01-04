using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;

namespace WebAmp.Web.Controllers;

/// <summary>
/// Controller for the WebAmp landing page.
/// </summary>
public class WebAmpController(IConfiguration configuration) : Controller
{
    /// <summary>
    /// Display the WebAmp landing page.
    /// </summary>
    [HttpGet("/webamp")]
    [HttpGet("/webamp/{*path}")]
    public IActionResult Index()
    {
        ViewData["Title"] = "WebAmp";
        ViewData["IsAppPage"] = true;

        // Configure the host layout behavior via appsettings.json (Portfolio host)
        var section = configuration.GetSection("AppPages:WebAmp");
        if (section.Exists())
        {
            ViewData["IsolatedCss"] = section.GetValue("IsolatedCss", false);
            ViewData["HideNavbar"] = section.GetValue("HideNavbar", false);
            ViewData["ShowLoadingOverlay"] = section.GetValue("ShowLoadingOverlay", true);

            var overlay = section.GetSection("LoadingOverlay");
            ViewData["LoadingOverlayLogoSrc"] = overlay.GetValue<string?>("LogoSrc");
            ViewData["LoadingOverlayLogoAlt"] = overlay.GetValue<string?>("LogoAlt");
            ViewData["LoadingOverlayThrobberSrc"] = overlay.GetValue<string?>("ThrobberSrc");
            ViewData["LoadingOverlayThrobberAlt"] = overlay.GetValue<string?>("ThrobberAlt");
        }

        // Explicit feature-folder view path so this module stays portable.
        return View("~/Apps/WebAmp/Views/Index.cshtml");
    }
}
