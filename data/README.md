# Supplier data

`supplier_risk_dataset.csv` is the organizer file: 10,000 anonymized suppliers, 46 columns, no blank cells. It is bundled so the deployed container loads it at startup (`SUPPLIER_CSV`, default in the Dockerfile). Set `SUPPLIER_CSV=sample` to start from the three-row fixture in `contracts/examples.json`, or import another CSV through the UI (kept in memory until restart).

Columns: `supplierID`, `Supplier Name`, `Total_Risk_Index` + `_Level`, 18 `*_Score` + `*_Level` pairs (Industry_Benchmark, Media_Sentiment, External_Intelligence, Sub_Tier_Visibility, Labor_Stability, Financial_Health, Compliance_Risk, Safety_Incident, Environmental_Exposure, ESG_Performance, Digital_Security, Operational_Resilience, Market_Sentiment, Quality_Risk, Governance_Risk, Geopolitical_Risk, Political_Stability, Credit_Rating), then `Purchase Order Volume (EUR)`, `Order Change Rate`, `Supplier Delivery Rating`, `Order Confirmation Rate`, `Sourcing Risk Level`, `Supply Chain Complexity`.

Every `_Score` is a risk score (0 lowest, 100 highest); the supplied `_Level` bands match 0–24 Low, 25–49 Medium, 50–74 High, 75–100 Critical. The Total Risk Index is close to the mean of the 18 scores in this file, but its formula is not published, so the app shows it unchanged and keeps its own buyer score separate.

There is no column describing manufactured components, location, certification, price or lead time. Gauge therefore screens by risk, lets a buyer scope the pool with known candidate IDs, and labels the capability gap. Supplier names are synthetic and must not be matched to real companies.

`reports/` (gitignored) stores completed company-research jobs as JSON so they survive an app restart.
