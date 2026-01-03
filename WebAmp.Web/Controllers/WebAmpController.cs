using Microsoft.AspNetCore.Mvc;

namespace WebAmp.Web.Controllers;

/// <summary>
/// Controller for the WebAmp landing page.
/// </summary>
public class WebAmpController : Controller
{
    /// <summary>
    /// Display the WebAmp landing page.
    /// </summary>
    [HttpGet("/webamp")]
    public IActionResult Index()
    {
        ViewData["Title"] = "WebAmp";
        ViewData["IsAppPage"] = true;

        // Explicit feature-folder view path so this module stays portable.
        return View("~/Apps/WebAmp/Views/Index.cshtml");
    }
}
