declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    FAMILY_OPS_MODE?: string;
    FAMILY_OPS_INSTALLATION_KIND?: string;
    FAMILY_OPS_INSTALLATION_OWNER_ID?: string;
    FAMILY_OPS_INSTALLATION_ID?: string;
    FAMILY_OPS_BILLING?: string;
    FAMILY_OPS_CHECKOUT?: string;
    FAMILY_OPS_OFFER_VERSION?: string;
    FAMILY_OPS_PUBLIC_ORIGIN?: string;
    STRIPE_BILLING_PORTAL_CONFIGURATION_ID?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    FAMILY_OPS_STRIPE_PRICE_ID?: string;
    FAMILY_OPS_SHARING?: string;
    FAMILY_OPS_INVITE_KEY_V1?: string;
  }
}
