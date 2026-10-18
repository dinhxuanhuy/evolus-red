import 'dotenv/config';

function req(name: string, fallback = ''): string {
  const v = process.env[name];
  if (!v && !fallback) {
    console.warn(`[config] missing env ${name}`);
  }
  return v ?? fallback;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  evolus: {
    baseUrl: 'https://api.evolus.ai',
    apiKey: req('EVOLUS_API_KEY'),
    applicationId: req('EVOLUS_APPLICATION_ID'),
    agents: {
      recon: req('EVOLUS_RECON_AGENT'),
      attacker: req('EVOLUS_ATTACKER_AGENT'),
      judge: req('EVOLUS_JUDGE_AGENT'),
      planner: req('EVOLUS_PLANNER_AGENT'),
    },
    workflowId: req('EVOLUS_WORKFLOW_ID'),
  },
};

export const AGENT_LABELS: Record<string, string> = {
  recon: 'ReconAgent',
  attacker: 'RedTeamAttacker',
  judge: 'ExplainJudge',
  planner: 'Planner',
};
