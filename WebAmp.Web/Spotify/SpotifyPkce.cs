using System.Security.Cryptography;
using System.Text;

namespace WebAmp.Web.Spotify;

// ============================================================================================
/// <summary>
/// Helper class for PKCE (Proof Key for Code Exchange) operations.
/// </summary>
public static class SpotifyPkce
{
    // ============================================================================================
    /// <summary>
    /// Creates a code verifier for the PKCE flow.
    /// </summary>
    /// <returns>The code verifier.</returns>
    public static string CreateCodeVerifier()
    {
        // RFC 7636: 43-128 chars, unreserved characters. We'll use base64url 32 bytes => 43 chars.
        var bytes = RandomNumberGenerator.GetBytes(32);
        return Base64UrlEncode(bytes);
    }

    // ============================================================================================
    /// <summary>
    /// Creates a code challenge for the PKCE flow.
    /// </summary>
    /// <param name="codeVerifier">The code verifier.</param>
    /// <returns>The code challenge.</returns>
    public static string CreateCodeChallenge(string codeVerifier)
    {
        var bytes = SHA256.HashData(Encoding.ASCII.GetBytes(codeVerifier));
        return Base64UrlEncode(bytes);
    }

    // ============================================================================================
    /// <summary>
    /// Creates a state for the PKCE flow.
    /// </summary>
    /// <returns>The state.</returns>
    public static string CreateState()
    {
        var bytes = RandomNumberGenerator.GetBytes(16);
        return Base64UrlEncode(bytes);
    }

    // ============================================================================================
    /// <summary>
    /// Encodes a byte array to a base64url string.
    /// </summary>
    /// <param name="bytes">The byte array.</param>
    /// <returns>The base64url string.</returns>
    private static string Base64UrlEncode(byte[] bytes)
    {
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }
}
