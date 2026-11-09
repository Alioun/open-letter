const OPERATIONAL =
  /^(verification|already[_-]signed|deletion|invite|zoom|treffen)(?:[._-]|$)/;

export function isCampaignTemplate(template) {
  return Boolean(template?.slug && !OPERATIONAL.test(template.slug));
}

export function campaignText(
  templateId,
  subject,
  translations,
  language,
  templates = [],
) {
  const own = translations?.[language] || {};
  const ownTemplate =
    own.templateId &&
    templates.find(
      (template) => String(template.id) === String(own.templateId),
    );
  return {
    templateId: own.templateId || templateId,
    subject: own.subject?.trim() || ownTemplate?.subject || subject,
    templateFallback: !own.templateId,
    subjectFallback: !own.subject?.trim() && !ownTemplate?.subject,
  };
}
