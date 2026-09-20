export class BuyerSearchRunNotFoundError extends Error {
  constructor(id) {
    super(`Buyer search run ${id} was not found.`);
    this.name = "BuyerSearchRunNotFoundError";
    this.code = "BUYER_SEARCH_RUN_NOT_FOUND";
  }
}

export class BuyerMatchNotFoundError extends Error {
  constructor(id) {
    super(`Buyer match ${id} was not found.`);
    this.name = "BuyerMatchNotFoundError";
    this.code = "BUYER_MATCH_NOT_FOUND";
  }
}
