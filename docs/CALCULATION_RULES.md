# Export Costing Rules

EXW =
Product
+ Packaging
+ Processing

FOB =
EXW
+ Trucking
+ Documentation
+ Port Charges
+ custom FOB-stage costs

CFR =
FOB
+ Freight
+ custom CFR-stage costs

CIF =
CFR
+ Insurance
+ custom CIF-stage costs

CostPerKg =
TotalCost / ShipmentQuantityKg

TargetMarginPrice =
Cost / (1 - TargetMargin)

TargetMarkupPrice =
Cost * (1 + Markup)

Profit =
Revenue - TotalCost

Margin =
Profit / Revenue