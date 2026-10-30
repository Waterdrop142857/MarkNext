/** A write was rejected because the file no longer has the expected version. */
export class DocumentConflict extends Error {
  constructor(readonly version: string, message = "The file changed outside MarkNext") {
    super(message);
    this.name = "DocumentConflict";
  }
}
