# MVP Milestones

This file tracks the remaining work needed to turn the Export Cost Calculator into the PRD-defined MVP.

Product principle:

> Complex engine, simple interface.

## Current Status

Completed:

- Calculation engine is separate from UI.
- Decimal-safe costing calculations are implemented.
- EXW, FOB, CFR, and CIF are calculated.
- IDR and USD cost rows are supported.
- Costs are converted into quotation currency.
- Cost per kg is calculated.
- Target margin, target markup, and buyer offer pricing are supported by the engine.
- Calculation unit tests are in place.
- A single-page costing editor exists.
- Editor currently supports product, quantity, Incoterm, USD/IDR, standard costs, and target margin.
- Live editor results show FOB, CFR, CIF, break-even, suggested price, and profit.
- Editor supports target margin, target markup, and buyer offer pricing modes.
- Editor supports flexible custom cost rows.
- Editor shows live revenue, margin, and markup.
- Editor shows warnings for below break-even buyer offers, missing freight, and missing insurance.
- Editor hides cost rows beyond the selected Incoterm:
  - FOB hides Freight and Insurance.
  - CFR hides Insurance.
  - CIF shows Freight and Insurance.
- Result panel hides quote stages beyond the selected Incoterm:
  - FOB hides CFR and CIF.
  - CFR hides CIF.
  - CIF shows FOB, CFR, and CIF.
- Browser-local persistence is implemented.
- User can save and reopen costings from the editor.
- New costings start with blank inputs and example placeholders.
- Save creates a new costing from an unsaved form.
- Opened costings use Update so edits do not look like a new save.
- New clears the editor before saving a separate costing.
- Saved costings include inputs, cost rows, pricing mode, exchange rate, result snapshot, and timestamps.
- Persistence tests cover save, reopen, update, and historical FX isolation.
- Costing history view is implemented.
- The app opens to the active costings list.
- History shows costing name, product, Incoterm, break-even, sell price, margin, and updated date.
- Active history supports Edit, Duplicate, and Archive actions.
- Archived costings are hidden from the default active history list.
- Archived costings have a dedicated Archived view.
- Archived costings can be duplicated or permanently deleted.
- Warning rules are covered by unit tests.
- Duplicate, archive, and delete persistence behavior is covered by unit tests.
- Corrupted browser-local storage is handled safely.
- Invalid calculation fields are highlighted in the editor.
- Empty editor state avoids broken result output.
- SQLite persistence is implemented through the local dev server.
- Browser save/open/history now use the SQLite API instead of local storage.
- SQLite repository tests cover save, reopen/update, archive, and delete behavior.

Not yet completed:

- Authentication.

## Milestone 1: Complete The Editor Workflow

Status:

Completed.

Goal:

Make the single-page editor feel like a complete calculator before adding persistence.

Tasks:

- Add pricing mode selector:
  - Target margin
  - Target markup
  - Buyer offer
- Show the relevant input for the selected pricing mode.
- Show live revenue.
- Show live margin.
- Show live markup when buyer offer is selected.
- Add warning messages:
  - Buyer offer below break-even.
  - Missing freight when CFR or CIF is selected.
  - Missing insurance when CIF is selected.
- Add flexible cost rows:
  - Add cost row.
  - Remove custom cost row.
  - Edit cost name.
  - Edit amount.
  - Select currency.
  - Select stage for custom rows.
- Keep standard rows simple and visible by default.
- Hide standard rows that are not relevant to the selected Incoterm.
- Hide result rows that are not relevant to the selected Incoterm.
- Keep advanced stage details unobtrusive.
- Improve validation messages for quantity, FX, costs, and pricing inputs.

Definition of Done:

- User can complete a full costing without persistence.
- User can choose margin, markup, or buyer offer pricing.
- Buyer offer clearly shows whether the shipment is profitable.
- No `NaN`, `Infinity`, or `undefined` appears in the UI.
- Existing calculation tests pass.

## Milestone 2: Add Persistence

Status:

Completed with browser-local persistence.

Goal:

Allow costings to be saved and reopened.

Tasks:

- Add persistence layer.
- Store costing header:
  - name
  - product
  - quantity
  - unit
  - Incoterm
  - quotation currency
  - USD/IDR exchange rate
  - pricing type
  - pricing value
  - status
  - created date
  - updated date
- Store cost rows:
  - costing id
  - name
  - amount
  - currency
  - stage
  - sort order
- Store calculated result snapshot.
- Add save action to the editor.
- Add edit existing costing behavior from the saved list.

Definition of Done:

- User can save a costing.
- Saved costing includes the exchange rate used at the time.
- User can reopen a saved costing and see the same inputs and calculated result.
- Historical costings do not change when new FX values are entered elsewhere.

Implementation note:

- Current persistence uses SQLite at `data/costings.sqlite`.
- The older browser-local persistence module remains covered by tests but is no longer used by the UI.
- PostgreSQL/Prisma can replace SQLite later if the internal MVP needs multi-user/shared deployment.

## Milestone 3: Add Costing History

Status:

Completed.

Goal:

Add the second core MVP page from the PRD.

Tasks:

- Add a simple costing history page.
- Show columns:
  - costing name
  - product
  - Incoterm
  - break-even
  - suggested price or buyer offer
  - margin
  - updated date
- Add actions:
  - Edit
  - Duplicate
  - Archive
- Hide archived costings from the default list.
- Make the active costings list the landing page.
- Keep saved-record navigation out of the editor.
- Add a dedicated archived costings view.
- Add permanent delete from archived costings.

Definition of Done:

- User can find previous costings.
- User can reopen a costing from the saved list.
- User can duplicate a costing.
- User can archive a costing.
- Duplicate creates a new editable costing with copied rows and settings.
- User can review archived costings separately from active costings.
- User can permanently delete archived costings.

## Milestone 4: MVP Hardening

Status:

Completed.

Goal:

Make the app trustworthy enough for internal use.

Tasks:

- Add unit tests for warning rules.
- Add tests for save/reopen behavior.
- Add tests for duplicate/archive behavior.
- Add field-level validation states.
- Improve empty and invalid states.
- Confirm mobile layout is usable.
- Confirm build passes.
- Confirm tests pass.
- Confirm lint passes if linting is added.

Definition of Done:

- A normal costing can be completed in less than 2 minutes.
- The app handles invalid input without broken output.
- The app matches the PRD acceptance scenario.
- Build passes.
- Tests pass.

Implementation note:

- No lint script exists yet, so lint is not currently applicable.
- Mobile layout uses responsive grid collapse and horizontal scrolling for the history table.

## Optional MVP Authentication

Goal:

Add simple internal authentication only when needed before real internal use.

Tasks:

- Add simple login.
- Add roles:
  - Admin
  - User
- Allow both roles to create costings.
- Reserve admin-only settings for later if not needed immediately.

Definition of Done:

- Internal users can access the app securely enough for MVP use.
- No complex permissions are introduced.

## Explicitly Out Of Scope For MVP

Do not implement these until there is a demonstrated workflow need:

- Product master.
- Customer master.
- Port database.
- Cost templates.
- Dashboards.
- Charts.
- Quotation PDFs.
- Invoices.
- Packing lists.
- Freight APIs.
- Real-time FX APIs.
- HS code lookup.
- Destination tariffs.
- Landed cost.
- Customs integration.
- CRM.
- Buyer finder.
- AI features.
- Approval workflow.
- Revision history.
- Complex audit logs.
- All Incoterms.
- Air freight.
- LCL.

## Recommended Next Task

Core local MVP workflow is complete.

Next decision:

> Decide whether this MVP needs simple authentication or shared database persistence before internal use.
