import { z } from "zod/v4";

export interface RequestIdentity {
  clientServiceId: string;
  tenantId: string;
  customerRef?: string;
}

const IdentitySchema = z.object({
  clientServiceId: z.coerce.string().min(1).max(200),
  tenantId: z.string().min(1).max(100),
  customerRef: z.string().max(100).optional(),
});

export function extractIdentityFromBody(body: unknown): RequestIdentity | null {
  const result = IdentitySchema.safeParse(body);
  return result.success ? result.data : null;
}

export function extractIdentityFromFormData(formData: FormData): RequestIdentity | null {
  const raw = {
    clientServiceId: formData.get("clientServiceId"),
    tenantId: formData.get("tenantId"),
    customerRef: formData.get("customerRef") ?? undefined,
  };
  const result = IdentitySchema.safeParse(raw);
  return result.success ? result.data : null;
}
