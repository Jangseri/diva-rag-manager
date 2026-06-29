import { faker } from "@faker-js/faker";
import { generateId } from "@/lib/id";
import type { DocumentRecord, DocumentResponse } from "@/types";
import { ALLOWED_FILE_FORMATS } from "@/lib/constants";

export function createDocumentRecord(
  overrides: Partial<DocumentRecord> = {}
): DocumentRecord {
  const format =
    overrides.file_format ||
    faker.helpers.arrayElement([...ALLOWED_FILE_FORMATS]);
  const fileName =
    overrides.file_name || `${faker.system.commonFileName(format)}`;
  const tenant_id = overrides.tenant_id || faker.string.alphanumeric(10);
  const file_id = overrides.file_id || generateId();
  const collection_name = overrides.collection_name || faker.string.numeric(2);

  return {
    file_id,
    source_type: "file",
    source_url: null,
    file_name: fileName,
    tenant_id,
    file_format: format,
    file_size: BigInt(faker.number.int({ min: 1024, max: 104857600 })),
    file_status: "UPLOADED",
    collection_name,
    origin_path: `/data/diva/origin/${collection_name}/${tenant_id}/${file_id}.${format}`,
    retry_count: 0,
    last_error_code: null,
    rgst_dt: faker.date.recent(),
    rgst_nm: faker.person.fullName(),
    status: "ACTIVE",
    updt_dt: faker.date.recent(),
    updt_nm: faker.person.fullName(),
    ...overrides,
  };
}

export function toDocumentResponse(record: DocumentRecord): DocumentResponse {
  return {
    file_id: record.file_id,
    source_type: record.source_type,
    source_url: record.source_url,
    file_name: record.file_name,
    tenant_id: record.tenant_id,
    file_format: record.file_format,
    file_size: record.file_size.toString(),
    file_status: record.file_status,
    collection_name: record.collection_name,
    origin_path: record.origin_path,
    retry_count: record.retry_count,
    last_error_code: record.last_error_code,
    rgst_dt: record.rgst_dt.toISOString(),
    rgst_nm: record.rgst_nm,
    status: record.status,
    updt_dt: record.updt_dt.toISOString(),
    updt_nm: record.updt_nm,
  };
}

export function createDocumentRecords(
  count: number,
  overrides: Partial<DocumentRecord> = {}
): DocumentRecord[] {
  return Array.from({ length: count }, () => createDocumentRecord(overrides));
}
