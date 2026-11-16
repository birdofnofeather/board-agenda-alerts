# Board Motion Tracker

This utility tracks the Board Motion items on the weekly cluster meeting agendas of the Los Angeles County Chief Executive Office.

The source of the agendas is <https://ceo.lacounty.gov/agendas/>.

## What the utility does

The utility follows four clusters:

- Operations
- Community Services
- Family & Social Services
- Health & Mental Health

For each agenda, the utility does these steps:

1. It reads the meeting date, the meeting time, and the Microsoft Teams link from the first page.
2. It finds the Board Motion section. If the section is absent or says "None", the agenda gets no cards.
3. It makes one card for each motion in that section.
4. It finds the backup materials for each motion and records the page number.
5. It writes a brief summary of each motion from the backup materials.

The website shows the cards in three tabs:

- **Next meeting** shows the motions for the next meeting date.
- **Past meetings** shows the motions for all earlier meetings.
- **Analysis** shows counts by cluster, by supervisorial district, and by month.

A search box and two filters are above the tabs. The search looks in the title, the summary, and the full text of each motion. The filters select one cluster or one supervisorial district. The search and the filters apply to all three tabs.

Each card opens to show the summary, a link to the backup materials at the correct page, and a link to the full agenda.

## Where each part lives

All parts are in this GitHub repository.

| Part | Location | Purpose |
| --- | --- | --- |
| Daily job | `.github/workflows/update-agendas.yml` | Starts the work one time each day. |
| Agenda reader | `scripts/agenda_parser.py` | Reads one agenda PDF with fixed rules. |
| Update program | `scripts/update_agendas.py` | Finds new agendas and saves the results. |
| Data file | `public/data/agendas.json` | Holds all meetings, motions, summaries, and motion text. |
| Website | `src/` | Shows the data file. |
| Summary service | `supabase/functions/extract-motions/` | Writes the brief summaries. |

GitHub runs the daily job, keeps the data, and publishes the website.

The summary service is the only part that operates outside GitHub. It operates on the Lovable Cloud backend of this project. If the summary service is not available, the card shows the first instruction from the motion text. The daily job then tries the summary service again on each subsequent run.

## How the daily job operates

The job starts each day at 15:23 UTC. This is 7:23 a.m. or 8:23 a.m. in Los Angeles.

1. The job gets the agenda list from the data feed of the county agenda page.
2. The job compares the list with the data file.
3. The job downloads only the agendas that are new or that have a new file address.
4. The job reads each agenda and saves the results in the data file.
5. The job builds the website and publishes it.

When the county replaces an agenda with a revised agenda, the job reads the revised file. The data file keeps a record of the replaced file and its motions. The card shows the label "Agenda revised".

GitHub keeps each version of the data file. The history of the file shows what changed and when.

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

## How to check that the job operates

1. Open the repository on GitHub.
2. Select the **Actions** tab.
3. Look at the newest run of **Update agendas and publish the site**.

A green mark shows a correct run. A red mark shows a problem. GitHub also sends an email to the repository owner when a run fails. Open the run and then open the step **Look for new agendas** to see the cause. The job tries failed agendas again on the next run.

## How to start the job by hand

1. Select the **Actions** tab.
2. Select **Update agendas and publish the site**.
3. Select **Run workflow**, then select the green **Run workflow** button.

## Limits

- The county data feed lists agendas for approximately the last six months. Older agendas stay in the data file after they leave the feed.
- The agenda reader depends on the layout of the county agendas. If the county changes the layout, the reader can miss a motion section. The data file records, for each agenda, whether the reader found a motion section.
- The reader uses the text layer of the PDF. It cannot read a motion that is only a scanned image.

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
