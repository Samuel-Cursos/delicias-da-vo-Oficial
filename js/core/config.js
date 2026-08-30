export const APP_CONFIG = {
  whatsapp: "5518991178906",
  storageCarrinho: "deliciasCarrinhoV4",
  storagePreview: "deliciasPreviewV3",
  admins: ["deliciasdavo54@gmail.com"],
  timeZone: "America/Sao_Paulo",
  previewMode: typeof location !== "undefined" && (
    location.hostname.endsWith(".chatgpt.site") ||
    location.hostname === "terminal.local" ||
    location.hostname.includes("-git-marmitas-empresariais-")
  )
};
