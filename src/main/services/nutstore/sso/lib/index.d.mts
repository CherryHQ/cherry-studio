interface CreateOAuthUrlArgs {
    app: string;
}
declare function createOAuthUrl({ app }: CreateOAuthUrlArgs): Promise<string>;
declare function _dont_use_in_prod_createOAuthUrl({ app, }: CreateOAuthUrlArgs): Promise<string>;

interface DecryptSecretArgs {
    app: string;
    s: string;
}
declare function decryptSecret({ app, s }: DecryptSecretArgs): Promise<string>;
declare function _dont_use_in_prod_decryptSecret({ app, s, }: DecryptSecretArgs): Promise<string>;

export { _dont_use_in_prod_createOAuthUrl, _dont_use_in_prod_decryptSecret, createOAuthUrl, type CreateOAuthUrlArgs, decryptSecret,type DecryptSecretArgs };
