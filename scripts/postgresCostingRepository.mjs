export function createPostgresCostingRepository(sql) {
  return {
    async list() {
      const rows = await sql`select * from public.costings order by updated_at desc`;
      return rows.map(rowToSavedCosting);
    },

    async get(id) {
      const rows = await sql`select * from public.costings where id = ${id} limit 1`;
      return rows[0] ? rowToSavedCosting(rows[0]) : undefined;
    },

    async save(draft, options) {
      const existing = options.existingId ? await this.get(options.existingId) : undefined;
      const saved = {
        ...draft,
        id: existing?.id ?? options.createId(),
        status: existing?.status ?? "ACTIVE",
        createdAt: existing?.createdAt ?? options.now,
        updatedAt: options.now,
      };
      const pricingValue = getPricingValue(saved.pricing);

      await sql`
        insert into public.costings (
          id, name, product, quantity_value, quantity_unit, incoterm,
          quotation_currency, usd_idr, pricing_type, pricing_value, status,
          created_at, updated_at, costs_json, exchange_rates_json, pricing_json, result_json
        ) values (
          ${saved.id}, ${saved.name}, ${saved.product}, ${String(saved.quantity.value)},
          ${saved.quantity.unit}, ${saved.incoterm}, ${saved.quotationCurrency},
          ${saved.exchangeRates.USD_IDR === undefined ? null : String(saved.exchangeRates.USD_IDR)},
          ${saved.pricing.type}, ${pricingValue}, ${saved.status}, ${saved.createdAt}, ${saved.updatedAt},
          ${sql.json(saved.costs)}, ${sql.json(saved.exchangeRates)}, ${sql.json(saved.pricing)}, ${sql.json(saved.result)}
        )
        on conflict (id) do update set
          name = excluded.name,
          product = excluded.product,
          quantity_value = excluded.quantity_value,
          quantity_unit = excluded.quantity_unit,
          incoterm = excluded.incoterm,
          quotation_currency = excluded.quotation_currency,
          usd_idr = excluded.usd_idr,
          pricing_type = excluded.pricing_type,
          pricing_value = excluded.pricing_value,
          status = excluded.status,
          updated_at = excluded.updated_at,
          costs_json = excluded.costs_json,
          exchange_rates_json = excluded.exchange_rates_json,
          pricing_json = excluded.pricing_json,
          result_json = excluded.result_json
      `;

      return saved;
    },

    async archive(id, now) {
      const rows = await sql`
        update public.costings
        set status = 'ARCHIVED', updated_at = ${now}
        where id = ${id}
        returning *
      `;
      return rows[0] ? rowToSavedCosting(rows[0]) : undefined;
    },

    async delete(id) {
      const rows = await sql`delete from public.costings where id = ${id} returning id`;
      return rows.length > 0;
    },
  };
}

function rowToSavedCosting(row) {
  return {
    id: row.id,
    name: row.name,
    product: row.product,
    quantity: { value: String(row.quantity_value), unit: row.quantity_unit },
    incoterm: row.incoterm,
    quotationCurrency: row.quotation_currency,
    exchangeRates: jsonValue(row.exchange_rates_json),
    costs: jsonValue(row.costs_json),
    pricing: jsonValue(row.pricing_json),
    result: jsonValue(row.result_json),
    status: row.status,
    createdAt: isoValue(row.created_at),
    updatedAt: isoValue(row.updated_at),
  };
}

function getPricingValue(pricing) {
  if (pricing.type === "MARGIN") return String(pricing.targetMargin);
  if (pricing.type === "MARKUP") return String(pricing.markup);
  return String(pricing.offerPricePerKg);
}

function jsonValue(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function isoValue(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}
