/** Shared error identity, independent of schemas that validate each other. */
export class KidsError extends Error {
 constructor(message:string,public status=400,public code?:'SOURCE_RECONCILIATION_REQUIRED'|'POLL_STORAGE_LIMIT'){super(message);}
}
