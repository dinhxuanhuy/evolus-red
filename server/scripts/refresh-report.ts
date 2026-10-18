/**
 * Regenerate the stored report for a campaign (uses the current report builder).
 * Usage: node scripts/refresh-report.ts <campaignId>
 */
import { getCampaign, listRounds, updateCampaign } from '../src/db.ts';
import { buildReport } from '../src/report.ts';

const id = process.argv[2];
if (!id) throw new Error('usage: node scripts/refresh-report.ts <campaignId>');
const campaign = getCampaign(id);
if (!campaign) throw new Error(`campaign not found: ${id}`);
const report = buildReport(campaign, listRounds(id));
updateCampaign(id, { report_json: JSON.stringify(report) });
console.log(
  JSON.stringify({
    campaign: campaign.name,
    rounds: report.stats.totalRounds,
    verdicts: report.stats.verdicts,
    worst: report.stats.worstSeverity,
    markdownChars: report.markdown.length,
    finishedAt: report.campaign.finishedAt,
  }),
);
