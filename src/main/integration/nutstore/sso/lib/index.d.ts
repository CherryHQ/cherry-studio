declare function decrypt(app: string, s: string): string;

interface Secret {
    app: string;
}
declare function createOAuthUrl(secret: Secret): string;

export { type Secret, createOAuthUrl, decrypt };
