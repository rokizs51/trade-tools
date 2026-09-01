# Product Requirements Document
## Export Cost Calculator — Simplified MVP

**Version:** 2.0  
**Product Type:** Internal Web Tool  
**Primary Goal:** Calculate export cost, minimum selling price, and expected profit as quickly as possible.

---

# 1. Product Summary

The Export Cost Calculator is a simple internal web application for calculating the real cost and profitability of an export shipment.

A user enters:

- shipment quantity
- export costs
- currency
- exchange rate
- Incoterm
- target margin or buyer price

The system automatically calculates:

- FOB / CFR / CIF cost
- cost per kg
- break-even selling price
- suggested selling price
- expected revenue
- expected profit
- margin

The application should hide accounting and Incoterm complexity wherever possible.

---

# 2. Core Product Principle

The application must follow:

> **Complex engine, simple interface.**

Users should not need to understand:

- internal cost stages
- database categories
- cost normalization formulas
- Incoterm calculation rules
- currency conversion logic

unless they explicitly open advanced options.

The default workflow should feel like using a calculator, not filling out ERP master data.

---

# 3. Success Definition

A normal export costing should be possible in:

> **Less than 2 minutes**

for a user who already knows the shipment costs.

The ideal flow is:

```text
Enter Shipment
      ↓
Enter Costs
      ↓
Enter FX
      ↓
Choose Incoterm
      ↓
Enter Margin / Buyer Price
      ↓
See Result
      ↓
Save
```

---

# 4. Primary Use Case

Example:

A salesperson wants to quote semi-husked coconut to a buyer in UAE.

They know:

```text
Quantity      25,000 kg
Product       Rp162,500,000
Packaging     Rp10,000,000
Trucking      Rp5,000,000
Documentation Rp2,500,000
Port Charges  Rp6,000,000
Freight       USD 1,450
Insurance     USD 80

USD/IDR       16,500
Target Margin 20%
```

The system should immediately show:

```text
FOB Cost          $0.487/kg
CFR Cost          $0.545/kg
CIF Cost          $0.548/kg

Break-even        $0.548/kg
Suggested Price   $0.685/kg

Revenue           $17,125
Profit            $3,425
Margin            20%
```

---

# 5. MVP Scope

The MVP contains only seven core capabilities.

## 5.1 Create Costing

User can start a new costing.

Required fields:

- costing name
- quantity
- quantity unit
- quotation currency
- Incoterm

Product name is recommended but may remain free text.

---

## 5.2 Enter Flexible Cost Rows

The user enters costs as simple rows.

Example:

| Cost | Amount | Currency |
|---|---:|---|
| Product | 162,500,000 | IDR |
| Packaging | 10,000,000 | IDR |
| Trucking | 5,000,000 | IDR |
| Documentation | 2,500,000 | IDR |
| Port Charges | 6,000,000 | IDR |
| Freight | 1,450 | USD |
| Insurance | 80 | USD |

Default cost types should be available.

Suggested defaults:

- Product
- Packaging
- Processing
- Trucking
- Documentation
- Port Charges
- Freight
- Insurance
- Other

Users can add custom costs using:

```text
+ Add Cost
```

---

# 6. Smart Cost Defaults

Each standard cost type internally has default calculation behavior.

Example:

```text
Product
→ EXW stage

Packaging
→ EXW stage

Trucking
→ FOB stage

Documentation
→ FOB stage

Port Charges
→ FOB stage

Freight
→ CFR stage

Insurance
→ CIF stage
```

The user does not need to choose these stages manually.

This allows the application to calculate:

```text
EXW
FOB
CFR
CIF
```

automatically.

---

# 7. Advanced Cost Options

Advanced options should remain hidden by default.

When needed:

```text
Advanced ▼
```

may expose:

- cost stage
- calculation basis
- quantity multiplier
- notes

Example:

```text
Ocean Freight

Amount
$1,450

Advanced ▼

Basis
Per Container

Quantity
2

Stage
CFR
```

Most users should never need this.

---

# 8. Shipment Inputs

The default shipment section should remain minimal.

Required:

```text
Product
Quantity
Unit
Incoterm
Quotation Currency
```

Example:

```text
Product
Semi-Husked Coconut

Quantity
25,000

Unit
kg

Incoterm
CIF

Currency
USD
```

Optional fields may include:

- customer
- destination
- container type
- number of containers
- notes

These should not block calculation.

---

# 9. Currency Handling

Each cost row may use its own currency.

For MVP, priority currencies are:

```text
IDR
USD
```

Architecture should allow more currencies later.

The costing has one quotation currency.

Example:

```text
Quotation Currency:
USD
```

All costs are converted into USD before calculation.

---

# 10. Exchange Rate

The user enters the exchange rate manually.

Example:

```text
USD / IDR

16,500
```

This should be prominently visible.

The rate used must be saved with the costing.

Historical costings must not automatically change if FX changes later.

---

# 11. Incoterm Support

MVP supports only:

```text
FOB
CFR
CIF
```

EXW may be calculated internally and displayed as useful information, but it does not need to be a primary quotation option initially.

Do not implement all Incoterms in V1.

---

# 12. Incoterm Calculation Logic

Internal calculation:

```text
Product
+
Packaging
+
Processing
=
EXW
```

Then:

```text
EXW
+
Trucking
+
Documentation
+
Port Charges
=
FOB
```

Then:

```text
FOB
+
Freight
=
CFR
```

Then:

```text
CFR
+
Insurance
=
CIF
```

Custom cost rows may be assigned to one of these stages through advanced options.

---

# 13. Cost Normalization

The primary unit for the MVP should be:

```text
Cost / kg
```

if shipment quantity is expressed in kg.

The system should also show:

```text
Total Cost
Cost / MT
Cost / Container
```

when enough data exists.

The main result should always prioritize the user's chosen shipment unit.

---

# 14. Pricing Modes

The user can choose one of three pricing modes.

## A. Target Margin

Example:

```text
Target Margin
20%
```

Formula:

```text
Selling Price =
Cost / (1 - Margin)
```

---

## B. Target Markup

Example:

```text
Markup
20%
```

Formula:

```text
Selling Price =
Cost × (1 + Markup)
```

---

## C. Buyer Offer

Example:

```text
Buyer Offer
$0.63/kg
```

The system calculates:

```text
Profit
Margin
Markup
Profit per shipment
```

The default mode should be:

> Target Margin

---

# 15. Break-Even

Break-even is one of the most important outputs.

Example:

```text
Break-even CIF
$0.548/kg
```

If buyer price is below break-even:

```text
⚠ Buyer offer is below break-even.

Estimated loss:
-$700 / shipment
```

This warning must be very clear.

---

# 16. Main Result Panel

The result should remain visible while the user edits the costing.

Primary results:

```text
Selected Cost
$0.548/kg

Break-even
$0.548/kg

Suggested Price
$0.685/kg

Expected Profit
$3,425

Margin
20%
```

Secondary results:

```text
FOB
$0.487/kg

CFR
$0.545/kg

CIF
$0.548/kg

Revenue
$17,125
```

Do not overload the primary result card with too many financial metrics.

---

# 17. Proposed Costing Screen

Desktop layout:

```text
┌───────────────────────────────────────────────────┐
│ Export Cost Calculator                            │
├──────────────────────────────┬────────────────────┤
│                              │                    │
│ SHIPMENT                     │ RESULT             │
│                              │                    │
│ Product                      │ CIF Cost           │
│ Semi-Husked Coconut          │ $0.548/kg          │
│                              │                    │
│ Quantity                     │ Break-even         │
│ 25,000 kg                    │ $0.548/kg          │
│                              │                    │
│ Incoterm                     │ Suggested Price    │
│ CIF                          │ $0.685/kg          │
│                              │                    │
│ USD / IDR                    │ Profit             │
│ 16,500                       │ $3,425             │
│                              │                    │
├──────────────────────────────┤ Margin             │
│ COSTS                        │ 20%                │
│                              │                    │
│ Product     Rp162,500,000    │                    │
│ Packaging    Rp10,000,000    │                    │
│ Trucking      Rp5,000,000    │                    │
│ Docs          Rp2,500,000    │                    │
│ Port          Rp6,000,000    │                    │
│ Freight            $1,450    │                    │
│ Insurance             $80    │                    │
│                              │                    │
│ + Add Cost                   │                    │
│                              │                    │
├──────────────────────────────┤                    │
│ PRICING                      │                    │
│                              │                    │
│ Target Margin      20%       │                    │
│                              │                    │
└──────────────────────────────┴────────────────────┘

                  [ Save Costing ]
```

The right-hand result section should update immediately.

---

# 18. Save Costing

A costing can be saved.

Store:

- name
- product
- quantity
- Incoterm
- currency
- exchange rate
- costs
- pricing method
- margin / markup / buyer offer
- calculated results
- created date
- updated date

---

# 19. Costing History

The second main page should simply show previous costings.

Example:

| Costing | Product | Incoterm | Cost | Sell Price | Margin |
|---|---|---|---:|---:|---:|
| Coconut UAE | Coconut | CIF | $0.548 | $0.685 | 20% |
| Coconut China | Coconut | FOB | $0.481 | $0.586 | 18% |

Actions:

```text
Open
Duplicate
Archive
```

No large dashboard is required.

---

# 20. Duplicate Costing

Duplicate is an MVP feature because export calculations are repetitive.

Example:

```text
Coconut UAE — Aug
       ↓
Duplicate
       ↓
Coconut UAE — Sep
```

The user may only need to change:

- product price
- FX
- freight
- quantity

Everything else remains available.

---

# 21. Product Master

Do NOT require a Product Master in V1.

Product may simply be:

```text
[ Semi-Husked Coconut ]
```

free text.

A reusable product database can be introduced later when duplicate data becomes inconvenient.

---

# 22. Customer Master

Not part of MVP.

Customer can initially be:

```text
Customer
[ Al Noor Trading ]
```

as an optional free-text field.

---

# 23. Port Master

Not part of MVP.

Destination can initially be free text:

```text
Destination
[ Jebel Ali, UAE ]
```

No port database is necessary.

---

# 24. Cost Templates

Not required for the first release.

Duplicate Costing already solves much of the same problem.

Templates should only be added when repeated cost structures become difficult to manage.

---

# 25. Authentication

Because this is an internal tool, authentication is needed.

MVP roles:

```text
ADMIN
USER
```

Do not build complex permissions initially.

Both roles can create costings.

Admin may manage:

- users
- default currencies
- default cost types

---

# 26. Validation

Required validation:

```text
Quantity > 0

Exchange Rate > 0

Costs >= 0

Margin >= 0
Margin < 100%

Selling Price >= 0
```

The application must never display:

```text
NaN
Infinity
undefined
```

---

# 27. Warning Rules

The MVP should contain a small number of meaningful warnings.

### Below break-even

```text
⚠ Buyer offer is below break-even.
```

### Missing Freight

When CFR/CIF is selected:

```text
⚠ No freight cost has been entered.
```

### Missing Insurance

When CIF is selected:

```text
⚠ No insurance cost has been entered.
```

### Low Margin

Optional:

```text
⚠ Margin is below your target.
```

Warnings should not unnecessarily block the user.

---

# 28. Functional Requirements

## FR-001

User can create a costing.

## FR-002

User can enter shipment quantity.

## FR-003

User can select FOB, CFR, or CIF.

## FR-004

User can add, edit, and remove cost rows.

## FR-005

Cost rows can use IDR or USD.

## FR-006

Application converts costs using the selected FX rate.

## FR-007

Application calculates EXW, FOB, CFR, and CIF internally.

## FR-008

Application calculates cost per unit.

## FR-009

Application calculates break-even price.

## FR-010

Application calculates selling price from margin.

## FR-011

Application calculates selling price from markup.

## FR-012

User can enter buyer offer.

## FR-013

Application calculates revenue and profit.

## FR-014

Application warns about loss-making prices.

## FR-015

User can save a costing.

## FR-016

User can reopen a saved costing.

## FR-017

User can duplicate a costing.

## FR-018

User can archive a costing.

---

# 29. Calculation Engine

The calculation engine must remain separate from frontend presentation.

Conceptual input:

```json
{
  "quantity": 25000,
  "unit": "KG",
  "quotationCurrency": "USD",
  "exchangeRates": {
    "USD_IDR": 16500
  },
  "incoterm": "CIF",
  "costs": [
    {
      "name": "Product",
      "amount": 162500000,
      "currency": "IDR",
      "stage": "EXW"
    },
    {
      "name": "Freight",
      "amount": 1450,
      "currency": "USD",
      "stage": "CFR"
    }
  ],
  "pricing": {
    "type": "MARGIN",
    "value": 0.20
  }
}
```

Conceptual output:

```json
{
  "exw": 0.43,
  "fob": 0.49,
  "cfr": 0.545,
  "cif": 0.548,
  "breakEven": 0.548,
  "sellingPrice": 0.685,
  "revenue": 17125,
  "profit": 3425,
  "margin": 0.20
}
```

---

# 30. Data Model

The MVP can remain very small.

Core entities:

```text
User

Costing

CostItem
```

Optional separate lookup tables:

```text
Currency
CostType
```

Conceptually:

```text
Costing
 ├── id
 ├── name
 ├── product_name
 ├── customer_name
 ├── destination
 ├── quantity
 ├── unit
 ├── incoterm
 ├── quotation_currency
 ├── exchange_rate
 ├── pricing_type
 ├── pricing_value
 ├── status
 ├── created_at
 └── updated_at

CostItem
 ├── id
 ├── costing_id
 ├── name
 ├── amount
 ├── currency
 ├── stage
 ├── basis
 └── sort_order
```

---

# 31. MVP Navigation

Keep navigation extremely small:

```text
Costings
New Costing
Settings
```

That is enough.

No need for:

```text
Dashboard
Products
Customers
Ports
Analytics
Templates
Documents
Reports
```

in V1.

---

# 32. Explicit Non-Goals

The following must NOT delay the MVP:

- Product master
- Customer master
- Port database
- freight APIs
- real-time FX APIs
- HS code lookup
- destination tariffs
- landed cost
- customs integration
- quotation PDFs
- invoices
- packing lists
- CRM
- buyer finder
- AI
- dashboards
- charts
- approval workflow
- revision history
- audit logs beyond timestamps
- all Incoterms
- air freight
- LCL

---

# 33. MVP Acceptance Test

The MVP can be considered successful if this scenario works correctly:

### User enters:

```text
Quantity:
25,000 kg

USD/IDR:
16,500

Product:
Rp162,500,000

Packaging:
Rp10,000,000

Trucking:
Rp5,000,000

Documentation:
Rp2,500,000

Port:
Rp6,000,000

Freight:
$1,450

Insurance:
$80

Incoterm:
CIF

Margin:
20%
```

### The application:

1. Converts IDR costs to USD.
2. Groups them into Incoterm stages.
3. Calculates FOB.
4. Calculates CFR.
5. Calculates CIF.
6. Calculates cost/kg.
7. Calculates break-even.
8. Calculates target selling price.
9. Calculates revenue.
10. Calculates profit.
11. Saves the costing.
12. Allows it to be duplicated.

If this experience is fast and trustworthy, the MVP is complete.

---

# 34. Product Evolution Rule

New features should only be added when they solve a demonstrated workflow problem.

For example:

```text
Problem:
Users repeatedly recreate the same cost rows.

Solution:
Add Cost Templates.
```

Not:

```text
Templates sound useful,
therefore build Templates.
```

Likewise:

```text
Problem:
Users cannot compare old freight costs.

Solution:
Add historical comparison.
```

This keeps the application lean.

---

# 35. Final Product Philosophy

The application should never become difficult to use simply because export costing itself is complicated.

The user experience should feel like:

```text
Product
Quantity
Costs
FX
Margin
        ↓
      RESULT
```

while internally the system handles:

```text
Cost categories
Currency normalization
Incoterm stages
Cost allocation
Break-even formulas
Margin formulas
Profit calculations
```

The guiding rule for every future feature should be:

> **If the system can infer it safely, do not ask the user to enter it.**

And:

> **If a field is only required for unusual scenarios, put it under Advanced Options.**

The MVP therefore focuses on one job:

> **Tell the exporter how much the shipment really costs, how low they can sell it, and how much profit they will make.**