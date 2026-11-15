export const TABS = [
  { key: 'server', title: 'PxgSettingsServer', isOwnerOnly: true },
  { key: 'outgoing', title: 'PxgSettingsOutgoing', isOwnerOnly: true },
  { key: 'incoming', title: 'PxgSettingsIncoming', isOwnerOnly: false },
  { key: 'folders', title: 'PxgSettingsFolders', isOwnerOnly: false },
  { key: 'requests', title: 'PxgSettingsMyRequests', isOwnerOnly: false },
  { key: 'contacts', title: 'PxgSettingsContacts', isOwnerOnly: false },
  { key: 'downloaded', title: 'PxgSettingsDownloaded', isOwnerOnly: false },
  { key: 'archive', title: 'PxgSettingsArchive', isOwnerOnly: true },
  { key: 'audit', title: 'PxgSettingsAudit', isOwnerOnly: true },
  { key: 'devices', title: 'PxgSettingsDevices', isOwnerOnly: false },
  { key: 'storage', title: 'PxgSettingsStorage', isOwnerOnly: false },
] as const;
