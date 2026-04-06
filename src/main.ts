import * as core from "@actions/core";
import { Octokit } from "@octokit/rest";
import { markdownTable } from "markdown-table";

interface CompareCommitsOptions {
  owner: string;
  repo: string;
  basehead: string;
  includeMergeCommits: boolean;
  shaLength: number;
}

const TICK = "`";

/**
 * Generate a markdown table of commits between a range
 * @param octokit A GitHub API instance
 */
async function generateTableLines(
  octokit: Octokit,
  {
    owner,
    repo,
    basehead,
    includeMergeCommits,
    shaLength,
  }: CompareCommitsOptions,
): Promise<string[][]> {
  const lines = [];

  for await (const response of octokit.paginate.iterator(
    octokit.rest.repos.compareCommitsWithBasehead,
    { owner, repo, basehead },
  )) {
    const { commits } = response.data as unknown as {
      commits: {
        sha: string;
        html_url: string;
        parents: { sha: string }[];
        commit: { message: string };
      }[];
    };
    for (const {
      sha: commitSha,
      html_url: shaUrl,
      parents,
      commit: { message },
    } of commits) {
      if (includeMergeCommits || parents.length < 2) {
        const sha = commitSha.slice(0, shaLength);
        const commitMessage = message.split("\n")[0];

        lines.push([
          `[${TICK}${sha}${TICK}](${shaUrl})`,
          // spaces are here to handle embedded backticks
          // github will remove the spaces in the rendered text
          `${TICK}${TICK} ${commitMessage} ${TICK}${TICK}`,
        ]);
      }
    }
  }

  lines.push(["Commit", "Message"]);
  return lines;
}

async function run(): Promise<void> {
  try {
    const octokit = new Octokit({
      auth: core.getInput("token", { required: false }),
    });

    const owner = core.getInput("owner", { required: true });
    const repo = core.getInput("repo", { required: true });
    const basehead = core.getInput("basehead", { required: true });
    const shaLength: number = JSON.parse(
      core.getInput("sha-length", { required: false }),
    );
    const includeMergeCommits: boolean = JSON.parse(
      core.getInput("include-merge-commits", { required: false }),
    );
    const verbose: boolean = JSON.parse(
      core.getInput("verbose", { required: false }),
    );
    const maxOutputLength: number = JSON.parse(
      core.getInput("max-output-length", { required: false }),
    );

    const lines = await generateTableLines(octokit, {
      owner,
      repo,
      basehead,
      includeMergeCommits,
      shaLength,
    });
    // reverse so the header row (last element) becomes the first row
    const reversedLines = lines.reverse();
    const totalCommits = reversedLines.length - 1; // exclude header row

    let table = markdownTable(reversedLines);

    if (table.length > maxOutputLength) {
      core.warning(
        `Output table is ${table.length} characters, ` +
          `exceeding max-output-length of ` +
          `${maxOutputLength}. Truncating.`,
      );

      // Binary search for the max number of rows that fit within the limit
      let lo = 1; // at minimum keep the header row
      let hi = reversedLines.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const slice = reversedLines.slice(0, mid);
        const omitted = totalCommits - (mid - 1);
        const suffix =
          omitted > 0
            ? `\n\n*... and ${omitted} more commit${omitted === 1 ? "" : "s"} (truncated)*`
            : "";
        const candidate = markdownTable(slice) + suffix;
        if (candidate.length <= maxOutputLength) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }

      const finalSlice = reversedLines.slice(0, lo);
      const omitted = totalCommits - (lo - 1);
      const suffix =
        omitted > 0
          ? `\n\n*... and ${omitted} more commit${omitted === 1 ? "" : "s"} (truncated)*`
          : "";
      table = markdownTable(finalSlice) + suffix;
    }

    if (verbose) {
      core.startGroup("Markdown table output"); // eslint-disable-line i18n-text/no-en
      core.info(table);
      core.endGroup();
    }

    core.setOutput("differences", table);
  } catch (error) {
    core.setFailed(`Action failed with error: ${error}`); // eslint-disable-line i18n-text/no-en
  }
}

run();
