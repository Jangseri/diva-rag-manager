import { faker } from "@faker-js/faker";
import { generateTsid } from "@/lib/tsid";
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

  return {
    uuid: generateTsid(),
    file_name: fileName,
    user_key: faker.string.alphanumeric(10),
    file_format: format,
    file_status: "UPLOADED",
    file_size: BigInt(faker.number.int({ min: 1024, max: 104857600 })),
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
    uuid: record.uuid,
    file_name: record.file_name,
    user_key: record.user_key,
    file_format: record.file_format,
    file_status: record.file_status,
    file_size: record.file_size.toString(),
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
