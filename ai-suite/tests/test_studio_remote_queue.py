import launcher


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeQueue:
    def __init__(self, queued):
        self.queued = queued
        self.jobs = {job["job_id"]: dict(job) for job in queued}

    def get_queue(self):
        return [dict(job) for job in self.queued]

    def get_running(self):
        return []

    def get_job(self, job_id):
        return self.jobs.get(job_id)


class FakeWorkflowManager:
    def __init__(self):
        self.workflows = {
            **{f"remote-{index}": {"manifest": {"remote": True, "minimum_vram_gb": 16}} for index in range(1, 6)},
            "split": {"manifest": {"remote": True, "minimum_vram_gb": 16, "split": True}},
            "local": {"manifest": {"remote": False}},
        }

    def _remote_gpu_enabled(self):
        return True

    def _remote_gpu_worker_url(self):
        return "http://gpu-worker"

    def _should_use_remote_gpu_worker(self, manifest):
        return manifest.get("remote", False)

    def _remote_required_vram_gb(self, manifest):
        return float(manifest.get("minimum_vram_gb", 0))

    def _remote_workflow_type(self, manifest):
        return "video"

    def _preview_remote_route(self, workflow_data, inputs, worker_url):
        manifest = workflow_data.get("manifest", {})
        return {"worker_id": "multi-gpu" if manifest.get("split") else "p100-0"}


def test_studio_releases_three_remote_jobs_and_one_local_lane(monkeypatch):
    queued = [
        {"job_id": f"r{index}", "workflow_id": f"remote-{index}", "inputs": {}}
        for index in range(1, 6)
    ] + [{"job_id": "local", "workflow_id": "local", "inputs": {}}]
    queue = FakeQueue(queued)
    manager = FakeWorkflowManager()
    workers = [
        {"id": f"p100-{index}", "healthy": True, "vram_gb": 16, "weight": 100,
         "inflight": 0, "max_inflight": 1, "tags": ["video", "image-to-3d"]}
        for index in range(3)
    ]
    dispatched = []

    def dispatch(job_id, workflow_id, inputs):
        dispatched.append(job_id)
        result = {"prompt_id": job_id}
        if job_id.startswith("r"):
            result["remote_job_id"] = f"remote-{job_id}"
        queue.jobs[job_id]["result"] = result

    monkeypatch.setattr(launcher, "job_queue", queue)
    monkeypatch.setattr(launcher, "workflow_manager", manager)
    monkeypatch.setattr(launcher, "config_manager", None)
    monkeypatch.setattr(launcher, "_dispatch_job", dispatch)
    monkeypatch.setattr(
        launcher.requests,
        "get",
        lambda url, **kwargs: FakeResponse({"waiting": [], "running": []})
        if url.endswith("/v1/mode") else FakeResponse(workers),
    )

    launcher._release_queued_jobs_unlocked()

    assert dispatched == ["r1", "r2", "r3", "local"]
    assert "r4" not in dispatched
    assert "r5" not in dispatched


def test_split_lane_reserves_remote_array_but_not_local_lane(monkeypatch):
    queued = [
        {"job_id": "split", "workflow_id": "split", "inputs": {}},
        {"job_id": "regular", "workflow_id": "remote-1", "inputs": {}},
        {"job_id": "local", "workflow_id": "local", "inputs": {}},
    ]
    queue = FakeQueue(queued)
    manager = FakeWorkflowManager()
    workers = [
        {"id": f"p100-{index}", "healthy": True, "vram_gb": 16, "weight": 100,
         "inflight": 0, "max_inflight": 1, "tags": ["video", "image-to-3d"]}
        for index in range(3)
    ] + [{"id": "multi-gpu", "healthy": False, "vram_gb": 48,
          "inflight": 0, "max_inflight": 1, "tags": ["video"]}]
    dispatched = []

    def dispatch(job_id, workflow_id, inputs):
        dispatched.append(job_id)
        if job_id == "split":
            queue.jobs[job_id]["result"] = {
                "remote_job_id": "exclusive-1", "remote_worker_id": "multi-gpu"
            }
        else:
            queue.jobs[job_id]["result"] = {"prompt_id": job_id}

    monkeypatch.setattr(launcher, "job_queue", queue)
    monkeypatch.setattr(launcher, "workflow_manager", manager)
    monkeypatch.setattr(launcher, "config_manager", None)
    monkeypatch.setattr(launcher, "_dispatch_job", dispatch)
    monkeypatch.setattr(
        launcher.requests,
        "get",
        lambda url, **kwargs: FakeResponse({"waiting": [], "running": []})
        if url.endswith("/v1/mode") else FakeResponse(workers),
    )

    launcher._release_queued_jobs_unlocked()

    assert dispatched == ["split", "local"]


def test_remote_waiting_job_without_prompt_id_stays_running(monkeypatch):
    class Queue:
        def __init__(self):
            self.job = {"job_id": "job-1", "user": "guest", "status": "queued"}

        def get_job(self, job_id):
            return self.job

        def start_job(self, job_id):
            self.job["status"] = "running"

        def update_job(self, job_id, **changes):
            self.job.update(changes)

    class Manager:
        @staticmethod
        def run_workflow(**kwargs):
            return True, {"prompt_id": "", "remote_job_id": "remote-1", "remote_worker_id": "multi-gpu"}

    queue = Queue()
    monkeypatch.setattr(launcher, "job_queue", queue)
    monkeypatch.setattr(launcher, "workflow_manager", Manager())

    launcher._dispatch_job("job-1", "video.test", {})

    assert queue.job["status"] == "running"
    assert queue.job["progress"] == 10
    assert queue.job["result"]["remote_job_id"] == "remote-1"


def test_reconcile_polls_remote_ticket_before_prompt_id_exists(monkeypatch):
    class Queue:
        def __init__(self):
            self.job = {
                "job_id": "job-1", "status": "running", "progress": 10,
                "result": {
                    "prompt_id": "", "remote_job_id": "remote-1",
                    "remote_worker_url": "http://gpu-worker",
                },
            }

        def get_running(self):
            return [self.job]

        def update_job(self, job_id, **changes):
            self.job.update(changes)

    queue = Queue()
    monkeypatch.setattr(launcher, "job_queue", queue)
    monkeypatch.setattr(launcher, "comfy_health_monitor", None)
    monkeypatch.setattr(
        launcher.requests,
        "get",
        lambda *args, **kwargs: FakeResponse({"state": "queued", "prompt_id": ""}),
    )

    launcher._reconcile_running_jobs()

    assert queue.job["status"] == "running"
    assert queue.job["progress"] == 15


def test_remote_asset_sync_ignores_long_prompt_text(tmp_path):
    comfy_dir = tmp_path / "ComfyUI"
    (comfy_dir / "input").mkdir(parents=True)
    manager = object.__new__(launcher.WorkflowManager)
    manager._runtime_config = lambda: {"COMFYUI_DIR": str(comfy_dir)}
    prompt = {
        "1": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "a cinematic prompt " * 100},
        }
    }

    assert manager._sync_remote_prompt_inputs(prompt, "http://gpu-worker") == []


def test_dependency_errors_deduplicate_shared_model():
    class Config:
        config = {"features": {"dependency_check": {"enabled": True}}}

    class Models:
        @staticmethod
        def check_model_availability(name, model_type):
            return False

    manager = launcher.DependencyManager(Config(), Models())
    dependency = {"name": "shared.safetensors", "directory": "checkpoints"}
    success, errors, _warnings = manager.check_workflow_dependencies({
        "models": {"required": [dependency, dict(dependency)]},
    })

    assert success is False
    assert errors == ["Required model not found: shared.safetensors (checkpoints)"]
