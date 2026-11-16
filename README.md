# Board Motion Tracker

This utility tracks the Board Motion items on the weekly cluster meeting agendas of the Los Angeles County Chief Executive Office.

The source of the agendas is <https://ceo.lacounty.gov/agendas/>.

## What the utility does

The utility follows four clusters:

- Operations
- Community Services
- Family & Social Services
- Health & Mental Health

For each cluster agenda, the utility does these steps:

1. It reads the meeting date, the meeting time, and the Microsoft Teams link from the first page.
2. It finds the Board Motion section. If the section is absent or says "None", the agenda gets no cards.
3. It makes one card for each motion in that section.
4. It finds the backup materials for each motion and records the page number.
5. It writes a brief summary of each motion from the backup materials.
6. It looks for each motion on the agendas of the Board of Supervisors.

## The comparison with the Board agendas

The source of the Board agendas is <https://bos.lacounty.gov/board-meeting-agendas/>.

Each card shows one of these results:

| Result | Meaning |
| --- | --- |
| On a Board agenda | The motion is on a regular or supplemental Board agenda. The card gives the date, the item number, the authors, and the file number. |
| Revised after cluster | The Board file contains a revised motion or a motion with updates after the cluster meeting. |
| Not on a Board agenda yet | The cluster meeting was less than five weeks ago, or the planned Board date is in the future. |
| Not found on a Board agenda | Five weeks passed and no Board agenda has a motion with this title. |
| No Board agenda data | The tracker has no Board agendas for the weeks after the cluster meeting. |

The card also tells you when the title on the Board agenda is different, and when the Board date is different from the date on the cluster agenda.

The comparison uses the title of the motion. A motion that goes to the Board with a fully new title shows as "Not found". Examine such a motion before you conclude that it was withdrawn.

The Board meeting page shows approximately the last ten meetings. The tracker keeps each Board agenda that it reads, so the record becomes longer with time.

## The website

The website shows the cards in three tabs:

- **Next meeting** shows the motions for the next cluster meeting date.
- **Past meetings** shows the motions for all earlier meetings.
- **Analysis** shows the Board results and counts by cluster, by supervisorial district, and by month.

A search box and three filters are above the tabs. The search looks in the title, the summary, and the full text of each motion. The filters select one cluster, one supervisorial district, or one Board result. The search and the filters apply to all three tabs.

## Where each part lives

All parts are in this GitHub repository.

| Part | Location | Purpose |
| --- | --- | --- |
| Daily job | `.github/workflows/update-agendas.yml` | Starts the work one time each day and publishes the website. |
| Agenda reader | `scripts/agenda_parser.py` | Reads one cluster agenda PDF with fixed rules. |
| Board agenda reader | `scripts/board_agendas.py` | Reads the Board agendas and does the comparison. |
| AI helper | `scripts/ai.py` | Writes the summaries and does the AI check. |
| Update program | `scripts/update_agendas.py` | Controls all the steps and saves the results. |
| Cluster data | `public/data/agendas.json` | Holds all meetings, motions, summaries, motion text, and Board results. |
| Board data | `public/data/board_agendas.json` | Holds the motions of the Supervisors from each Board agenda. |
| Status | `public/data/status.json` | Holds the time and the problems of the last run. |
| Website | `src/` | Shows the data files. |

## The AI and its key

The AI does two tasks. It writes the brief summary of each motion. It also counts the motions on the first pages of each agenda, as a second check on the fixed rules. If the two counts are different, the job records a problem.

The AI is Claude, from Anthropic. The job reads the key for the AI service from a GitHub secret with the name `ANTHROPIC_API_KEY`. A GitHub secret is encrypted. It is not visible in the repository, in the website, or in the job records.

To add the key:

1. Make an account at <https://console.anthropic.com> and add a small amount of credit.
2. Make an API key there and copy it.
3. Open the repository on GitHub and select **Settings**.
4. Select **Secrets and variables**, then **Actions**.
5. Select **New repository secret**.
6. Type `ANTHROPIC_API_KEY` as the name, paste the key as the secret, and select **Add secret**.

Without the key, the tracker continues to operate. A new card then shows the first instruction from the motion text as its summary, and the AI check does not run. After you add the key, the next run replaces these summaries.

## How the daily job operates

The job starts each day at 15:23 UTC. This is 7:23 a.m. or 8:23 a.m. in Los Angeles. The job also starts after each change to the code.

1. The job gets the cluster agenda list from the data feed of the county agenda page.
2. The job downloads only the agendas that are new or that have a new file address.
3. The job reads each agenda and saves the results.
4. The job reads the Board agendas that are new and does the comparison again for all motions.
5. The job builds the website and publishes it.

When the county replaces an agenda with a revised agenda, the job reads the revised file. The data file keeps a record of the replaced file and its motions. The card shows the label "Agenda revised".

GitHub keeps each version of the data files. The history of the files shows what changed and when.

## Problem notices

A problem with one agenda does not stop the job. The job records the problems in a GitHub issue with the title **Tracker status**. To see it, select the **Issues** tab of the repository.

GitHub sends you a notice when the job makes this issue. If the problems continue, the job adds one comment each week at most, and GitHub sends a notice for that comment. The text at the top of the issue always shows the newest result. Close the issue when the problems are gone.

## How to publish the website on GitHub Pages

Do these steps one time.

1. Open the repository on GitHub.
2. Select **Settings**.
3. If the repository is private and the account is on the free plan, make the repository public. Go to the bottom of the **General** page, find **Danger Zone**, and select **Change visibility**.
4. Select **Pages** in the left menu.
5. Below **Build and deployment**, set **Source** to **GitHub Actions**.
6. Select the **Actions** tab at the top of the repository.
7. Select **Update agendas and publish the site** in the left menu.
8. Select **Run workflow**, then select the green **Run workflow** button.

After approximately three minutes, the website is available at `https://<account name>.github.io/board-agenda-alerts/`.

After that, each change that is saved to the `main` branch publishes the website automatically.

## How to start the job by hand

1. Select the **Actions** tab.
2. Select **Update agendas and publish the site**.
3. Select **Run workflow**, then select the green **Run workflow** button.

## Limits

- The county data feed lists cluster agendas for approximately the last six months. Older agendas stay in the data file after they leave the feed.
- The agenda reader depends on the layout of the county agendas. The AI check finds most cases where a layout change makes the reader miss a motion.
- The reader uses the text layer of the PDF. It cannot read a motion that is only a scanned image.
- The Board comparison covers motions of the Supervisors only. It does not cover Board Letters from departments.

## Development

The website uses Vite, React, TypeScript, and Tailwind CSS. The update program uses Python.

```sh
npm install
npm run dev
```

```sh
pip install -r scripts/requirements.txt
python scripts/update_agendas.py
```
