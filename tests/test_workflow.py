import asyncio
import base64
import copy
import csv
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

os.environ.setdefault("APP_PASSWORD", "local-test-password")
os.environ["SUPPLIER_CSV"] = "sample"
os.environ["REPORTS_DIR"] = tempfile.mkdtemp(prefix="gauge-reports-")
os.environ["NEBIUS_API_KEY"] = "test-key-not-real"
os.environ["TAVILY_API_KEY"] = "test-key-not-real"
from fastapi.testclient import TestClient
from app import main as m


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.rows = copy.deepcopy(m.STATE)
        self.client = TestClient(m.app)
        self.client.headers["Authorization"] = "Basic " + base64.b64encode(
            (os.getenv("APP_USERNAME", "jury") + ":" + os.environ["APP_PASSWORD"]).encode()).decode()

    def tearDown(self):
        m.STATE.update(self.rows)

    def test_login_and_secret_boundary(self):
        self.assertEqual(TestClient(m.app).get("/").status_code, 401)
        self.assertEqual(TestClient(m.app).get("/api/status").status_code, 401)
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertNotIn(os.environ["APP_PASSWORD"], self.client.get("/api/status").text)
        self.assertNotIn("test-key-not-real", self.client.get("/api/status").text)
        self.assertEqual(self.client.get("/healthz").status_code, 200)
        with patch.dict(os.environ, {"APP_PASSWORD": "__SET_ME__"}):
            self.assertEqual(self.client.get("/api/status").status_code, 503)

    def test_auth_can_be_switched_off(self):
        with patch.dict(os.environ, {"APP_AUTH": "off", "APP_PASSWORD": ""}):
            anon = TestClient(m.app)
            self.assertEqual(anon.get("/").status_code, 200)
            self.assertFalse(anon.get("/api/status").json()["auth"])
        self.assertEqual(TestClient(m.app).get("/api/status").status_code, 401)

    def test_placeholder_keys_are_unconfigured(self):
        with patch.dict(os.environ, {"NEBIUS_API_KEY": "__SET_ME__", "TAVILY_API_KEY": "   "}):
            status = self.client.get("/api/status").json()
        self.assertFalse(status["nemotron"])
        self.assertFalse(status["tavily"])
        self.assertFalse(status["providers"]["nemotron"]["configured"])

    def test_quality_finance_and_unavailable_change_winner(self):
        quality = self.client.post("/api/shortlist", json={"profile":"quality_first"}).json()
        self.assertEqual([r["id"] for r in quality["suppliers"]], ["SUPP_00003","SUPP_00006","SUPP_00018"])
        self.assertEqual([r["buyer_score"] for r in quality["suppliers"]], [21.6,22.9,79.5])
        finance = self.client.post("/api/shortlist", json={"profile":"financial_first"}).json()
        self.assertEqual(finance["suppliers"][0]["id"], "SUPP_00006")
        excluded = self.client.post("/api/shortlist", json={"exclude":["SUPP_00003"]}).json()
        self.assertEqual(excluded["suppliers"][0]["id"], "SUPP_00006")
        self.assertEqual(excluded["excluded"], [{"id": "SUPP_00003", "name": "Advanced Systems 395"}])
        self.assertEqual(quality["suppliers"][0]["tri"], 34)

    def test_empty_scope_unknown_candidate_and_threshold(self):
        low = self.client.post("/api/shortlist", json={"max_risk":10}).json()
        self.assertEqual(low["suppliers"], [])
        scoped = self.client.post("/api/shortlist", json={"candidate_ids":["missing"]}).json()
        self.assertEqual(scoped["suppliers"], [])
        self.assertEqual(scoped["missing_candidate_ids"], ["missing"])
        self.assertEqual(self.client.post("/api/shortlist", json={"profile":"nope"}).status_code, 422)

    def test_comparison_bounds_and_unknown_id(self):
        self.assertEqual(self.client.post("/api/compare",json={"ids":["missing"]}).status_code,422)
        self.assertEqual(self.client.post("/api/compare",json={"ids":["SUPP_00003"]*21}).status_code,422)
        result=self.client.post("/api/compare",json={"ids":["SUPP_00003","SUPP_00006"]}).json()
        self.assertEqual(result["suppliers"][1]["scores"][m.F],18)

    def test_csv_upload_and_missing_score_is_not_zero(self):
        rows=json.loads((m.ROOT/"contracts/examples.json").read_text())["source_rows"]
        rows[0][m.Q]=""
        rows[1]["Total_Risk_Index"]="not-a-number"
        stream=io.StringIO()
        writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        response=self.client.post("/api/upload",files={"file":("full.csv",stream.getvalue(),"text/csv")})
        self.assertEqual(response.status_code,200)
        self.assertFalse(response.json()["sample"])
        result=self.client.post("/api/shortlist",json={}).json()
        self.assertEqual(result["unrankable"],1)
        self.assertEqual(result["risk_filtered"],1)
        self.assertEqual([r["id"] for r in result["suppliers"]],["SUPP_00018"])
        detail=self.client.post("/api/compare",json={"ids":["SUPP_00003"]}).json()["suppliers"][0]
        self.assertIsNone(detail["scores"][m.Q])

    def test_bad_upload_does_not_replace_good_dataset(self):
        before=m.STATE["version"]
        for payload in ("hello,world\na,b", "supplierID,Supplier Name\nA,Dup\nA,Dup2"):
            response=self.client.post("/api/upload",files={"file":("bad.csv",payload,"text/csv")})
            self.assertEqual(response.status_code,422)
        self.assertEqual(m.STATE["version"],before)

    def test_full_organizer_csv_loads_with_operational_columns(self):
        path=m.ROOT/"data/supplier_risk_dataset.csv"
        if not path.exists():
            self.skipTest("organizer CSV not bundled")
        m.install_data(m.read_csv(path.read_bytes()),str(path))
        self.assertEqual(len(m.STATE["rows"]),10000)
        result=self.client.post("/api/shortlist",json={"profile":"balanced","max_risk":30}).json()
        self.assertEqual(len(result["suppliers"]),20)
        self.assertEqual(result["unrankable"],0)
        self.assertTrue(all(r["tri"]<=30 for r in result["suppliers"]))
        scores=[r["buyer_score"] for r in result["suppliers"]]
        self.assertEqual(scores,sorted(scores))
        first=self.client.post("/api/compare",json={"ids":["SUPP_00001"]}).json()["suppliers"][0]
        self.assertEqual(first["operations"]["po_volume_eur"],129814.45)
        self.assertEqual(first["operations"]["supply_chain_complexity"],"Simple")
        self.assertEqual(len(first["scores"]),18)

    def test_disconnected_agent_is_honest(self):
        with patch.dict(os.environ,{"NEBIUS_API_KEY":"","TAVILY_API_KEY":"__SET_ME__"}):
            self.assertEqual(self.client.post("/api/chat",json={"message":"Find suppliers"}).status_code,503)
            self.assertEqual(self.client.post("/api/research",json={"company":"Real Company"}).status_code,503)
            status=self.client.post("/api/connection-test").json()
            self.assertFalse(status["providers"]["nemotron"]["ok"])
            self.assertIn("not configured",status["providers"]["nemotron"]["detail"])

    def test_connection_test_reports_provider_failure_without_secret(self):
        with patch.object(m,"model",AsyncMock(side_effect=m.ProviderError("Nemotron (Token Factory) returned HTTP 401: unauthorized"))):
            status=self.client.post("/api/connection-test").json()
        self.assertFalse(status["providers"]["nemotron"]["ok"])
        self.assertIn("HTTP 401",status["providers"]["nemotron"]["detail"])
        self.assertNotIn("test-key-not-real",json.dumps(status))

    def test_anonymized_research_is_rejected(self):
        for company in ["SUPP_00003","Advanced Systems 395"]:
            r=self.client.post("/api/research",json={"company":company})
            self.assertEqual(r.status_code,422)

    def test_agent_executes_tool_and_updates_ui_result(self):
        mock=AsyncMock(side_effect=[
            {"role":"assistant","content":"<think>reasoning</think>","tool_calls":[{"id":"call-1","type":"function","function":{"name":"rank_suppliers","arguments":json.dumps({"profile":"financial_first","exclude":["SUPP_00006"]})}}]},
            {"role":"assistant","content":"<think>hidden</think>SUPP_00003 now leads under financial-first weights."}])
        with patch.object(m,"model",mock):
            r=self.client.post("/api/chat",json={"message":"Prioritize financial resilience","selection":{"exclude":["SUPP_00018"]}})
        self.assertEqual(r.status_code,200)
        data=r.json()
        self.assertEqual(data["reply"],"SUPP_00003 now leads under financial-first weights.")
        self.assertEqual(data["selection"]["suppliers"][0]["id"],"SUPP_00003")
        self.assertEqual(data["selection"]["request"]["exclude"],["SUPP_00006","SUPP_00018"])
        self.assertEqual(data["trace"][0]["tool"],"rank_suppliers")
        self.assertEqual(data["trace"][0]["status"],"done")
        sent=mock.await_args_list[0].args[0][1]["content"]
        self.assertNotIn("source_levels",sent)

    def test_agent_inspects_suppliers_and_rejects_anonymized_research(self):
        mock=AsyncMock(side_effect=[
            {"role":"assistant","content":None,"tool_calls":[
                {"id":"c1","type":"function","function":{"name":"inspect_suppliers","arguments":{"ids":["SUPP_00018"]}}},
                {"id":"c2","type":"function","function":{"name":"research_company","arguments":json.dumps({"company":"Global Logistics 175"})}}]},
            {"role":"assistant","content":"SUPP_00018 has operational risk 95."}])
        with patch.object(m,"model",mock):
            r=self.client.post("/api/chat",json={"message":"Explain SUPP_00018"}).json()
        self.assertEqual(r["comparison"]["suppliers"][0]["id"],"SUPP_00018")
        self.assertEqual([t["status"] for t in r["trace"]],["done","error"])
        self.assertIsNone(r["job_id"])

    def test_provider_error_does_not_fabricate_answer(self):
        with patch.object(m,"model",AsyncMock(side_effect=m.ProviderError("Nemotron (Token Factory) returned HTTP 402: insufficient credits"))):
            r=self.client.post("/api/chat",json={"message":"Why this supplier?"})
        self.assertEqual(r.status_code,502)
        self.assertIn("HTTP 402",r.json()["detail"])
        self.assertIn("No simulated answer",r.json()["detail"])
        with patch.object(m,"model",AsyncMock(side_effect=RuntimeError("boom"))):
            r=self.client.post("/api/chat",json={"message":"Why this supplier?"})
        self.assertEqual(r.status_code,502)

    def test_research_follow_up_sources_and_persistence(self):
        async def run():
            job={"id":"job-test-1","company":"Real Example","context":"rail brakes","started":m.time.time(),"created":m.time.time(),"steps":[],"sources":[],"status":"queued"}
            responses=[{"content":"```json\n"+json.dumps({"queries":["identity","products","news"]})+"\n```"},
                       {"content":json.dumps({"follow_up_query":"clarify plant incident","reason":"Verify scope"})},
                       {"content":"## Identity and fit\nThe source describes a rail component business [1]. Verify qualification before purchase."}]
            searches=AsyncMock(return_value=[{"title":"Company report","url":"https://example.com/report","content":"Example evidence"}])
            with patch.object(m,"model",AsyncMock(side_effect=responses)),patch.object(m,"search",searches):
                await m.do_research(job)
            self.assertEqual(job["status"],"done")
            self.assertEqual(searches.await_count,4)
            self.assertEqual(len(job["sources"]),1)
            self.assertFalse(job["citation_warning"])
            self.assertTrue(all(x["state"]=="done" for x in job["steps"]))
            self.assertTrue((m.REPORTS_DIR/"job-test-1.json").exists())
            m.JOBS.clear(); m.load_reports()
            self.assertIn("job-test-1",m.JOBS)
        asyncio.run(run())
        listing=self.client.get("/api/research").json()["jobs"]
        self.assertEqual(listing[0]["company"],"Real Example")
        self.assertEqual(self.client.get("/api/research/job-test-1").json()["status"],"done")
        self.assertEqual(self.client.get("/api/research/nope").status_code,404)

    def test_research_provider_error_is_shown_not_hidden(self):
        async def run():
            job={"id":"job-test-2","company":"Real Example","context":"rail","started":m.time.time(),"created":m.time.time(),"steps":[],"sources":[],"status":"queued"}
            with patch.object(m,"model",AsyncMock(return_value={"content":json.dumps({"queries":["a","b","c"]})})),\
                 patch.object(m,"search",AsyncMock(side_effect=m.ProviderError("Tavily returned HTTP 432: credits exhausted"))):
                await m.do_research(job)
            self.assertEqual(job["status"],"error")
            self.assertIn("HTTP 432",job["error"])
            self.assertEqual(job["steps"][-1]["state"],"error")
        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
