export function createPostgresLoadPlanRepository(sql) {
  return {
    async list() {
      const rows = await sql`select * from public.load_plans order by updated_at desc`;
      return rows.map(rowToSavedLoadPlan);
    },

    async get(id) {
      const rows = await sql`select * from public.load_plans where id = ${id} limit 1`;
      return rows[0] ? rowToSavedLoadPlan(rows[0]) : undefined;
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

      await sql`
        insert into public.load_plans (
          id, name, product, container_id, cartons_loaded, total_units, status,
          created_at, updated_at, cargo_input_json, result_json, comparisons_json
        ) values (
          ${saved.id}, ${saved.name}, ${saved.cargoInput.productName ?? ""}, ${saved.containerId},
          ${saved.result.cartonsLoaded}, ${saved.result.totalUnits}, ${saved.status},
          ${saved.createdAt}, ${saved.updatedAt}, ${sql.json(saved.cargoInput)},
          ${sql.json(saved.result)}, ${sql.json(saved.comparisons)}
        )
        on conflict (id) do update set
          name = excluded.name,
          product = excluded.product,
          container_id = excluded.container_id,
          cartons_loaded = excluded.cartons_loaded,
          total_units = excluded.total_units,
          status = excluded.status,
          updated_at = excluded.updated_at,
          cargo_input_json = excluded.cargo_input_json,
          result_json = excluded.result_json,
          comparisons_json = excluded.comparisons_json
      `;

      return saved;
    },

    async archive(id, now) {
      const rows = await sql`
        update public.load_plans
        set status = 'ARCHIVED', updated_at = ${now}
        where id = ${id}
        returning *
      `;
      return rows[0] ? rowToSavedLoadPlan(rows[0]) : undefined;
    },

    async delete(id) {
      const rows = await sql`delete from public.load_plans where id = ${id} returning id`;
      return rows.length > 0;
    },
  };
}

function rowToSavedLoadPlan(row) {
  return {
    id: row.id,
    name: row.name,
    cargoInput: jsonValue(row.cargo_input_json),
    containerId: row.container_id,
    loadingMode: "FLOOR_LOADED",
    result: jsonValue(row.result_json),
    comparisons: jsonValue(row.comparisons_json),
    status: row.status,
    createdAt: isoValue(row.created_at),
    updatedAt: isoValue(row.updated_at),
  };
}

function jsonValue(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function isoValue(value) {
  return value instanceof Date ? value.toISOString() : String(value);
}
