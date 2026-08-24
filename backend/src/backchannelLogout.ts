import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

export const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

export interface BackchannelLogoutClaims {
  subject?: string;
  sessionId?: string;
}

export async function verifyBackchannelLogoutToken(
  token: string,
  issuer: string,
  audience: string,
  key: JWTVerifyGetKey,
): Promise<BackchannelLogoutClaims> {
  const { payload, protectedHeader } = await jwtVerify(token, key, {
    issuer,
    audience,
    requiredClaims: ["iss", "aud", "exp", "iat", "jti", "events"],
  });

  if (protectedHeader.typ?.toLowerCase() !== "logout+jwt") {
    throw new Error("Back-channel logout token type is invalid");
  }

  validateLogoutClaims(payload);
  return {
    subject: typeof payload.sub === "string" ? payload.sub : undefined,
    sessionId: typeof payload.sid === "string" ? payload.sid : undefined,
  };
}

export function createRemoteBackchannelLogoutVerifier(issuer: string, audience: string, jwksUri: string) {
  const key = createRemoteJWKSet(new URL(jwksUri));
  return (token: string) => verifyBackchannelLogoutToken(token, issuer, audience, key);
}

function validateLogoutClaims(payload: JWTPayload) {
  if ("nonce" in payload) throw new Error("Back-channel logout tokens must not contain nonce");
  if (!(typeof payload.sub === "string" && payload.sub) && !(typeof payload.sid === "string" && payload.sid)) {
    throw new Error("Back-channel logout tokens require sub or sid");
  }

  const events = payload.events;
  if (!events || typeof events !== "object" || Array.isArray(events) || !(BACKCHANNEL_LOGOUT_EVENT in events)) {
    throw new Error("Back-channel logout event is missing");
  }
  const eventValue = (events as Record<string, unknown>)[BACKCHANNEL_LOGOUT_EVENT];
  if (!eventValue || typeof eventValue !== "object" || Array.isArray(eventValue)) {
    throw new Error("Back-channel logout event is invalid");
  }
}
