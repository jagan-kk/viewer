import os

import httpx
from dotenv import load_dotenv

load_dotenv()


class GitHubClient:
    def __init__(self):
        self.token = os.getenv("GITHUB_TOKEN")

        if not self.token:
            raise ValueError("GITHUB_TOKEN is not set")

        self.base_url = "https://api.github.com"

        self.headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def get_workflow_runs(self, owner: str, repo: str):
        url = f"{self.base_url}/repos/{owner}/{repo}/actions/runs"

        async with httpx.AsyncClient() as client:
            response = await client.get(
                url,
                headers=self.headers,
            )

        response.raise_for_status()

        return response.json()