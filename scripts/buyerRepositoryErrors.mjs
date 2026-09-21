export class BuyerSearchRunNotFoundError extends Error {
  constructor(id) {
    super(`Buyer search run ${id} was not found.`);
    this.name = "BuyerSearchRunNotFoundError";
    this.code = "BUYER_SEARCH_RUN_NOT_FOUND";
  }
}

export class BuyerSearchRunNotTerminalError extends Error {
  constructor(id, status) {
    super(`Buyer search run ${id} cannot be deleted while its status is ${status}.`);
    this.name = "BuyerSearchRunNotTerminalError";
    this.code = "BUYER_SEARCH_NOT_TERMINAL";
  }
}

export class BuyerMatchNotFoundError extends Error {
  constructor(id) {
    super(`Buyer match ${id} was not found.`);
    this.name = "BuyerMatchNotFoundError";
    this.code = "BUYER_MATCH_NOT_FOUND";
  }
}
