using System.Security.Cryptography;
using System.Text;

namespace WebAmp.Web.SoundCloud;

/// <summary>
/// Helper for PKCE (Proof Key for Code Exchange) operations used by the
/// SoundCloud Authorization Code flow.
/// </summary>
public static class SoundCloudPkce
{
    /// <summary>
    /// Creates a code verifier for the PKCE flow.
    /// </summary>
    public static string CreateCodeVerifier()
    {
        // RFC 7636: 43-128 chars, unreserved characters. We'll use base64url 32 bytes => 43 chars.
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Base64UrlEncode(bytes);
    }

    /// <summary>
    /// Creates a code challenge from a verifier using SHA256.
    /// </summary>
    public static string CreateCodeChallenge(string codeVerifier)
    {
        var bytes = SHA256.HashData(Encoding.ASCII.GetBytes(codeVerifier));
        return Base64UrlEncode(bytes);
    }

    /// <summary>
    /// Creates a random state value for CSRF protection.
    /// </summary>
    public static string CreateState()
    {
        var bytes = RandomNumberGenerator.GetBytes(16);
        return Base64UrlEncode(bytes);
    }

    private static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }
}
