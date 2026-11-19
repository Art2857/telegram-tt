import {
  memo, useEffect, useMemo, useRef, useState,
} from '../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../global';

import type {
  ApiBotCommand, ApiChat, ApiDisallowedGifts,
} from '../../api/types';
import type { OwnerChatChange } from '../../proxygram/server/types';
import type { IAnchorPosition, ThreadId } from '../../types';
import type { IconName } from '../../types/icons';
import type { RegularLangKey } from '../../types/language';
import { MAIN_THREAD_ID } from '../../api/types';

import { SERVICE_NOTIFICATIONS_USER_ID, UNMUTE_TIMESTAMP } from '../../config';
import {
  getCanAddContact,
  getCanDeleteChat,
  getCanManageTopic,
  getHasAdminRight,
  getIsSavedDialog,
  isChatAdmin,
  isChatArchived,
  isChatChannel,
  isChatGroup,
  isSystemBot,
  isUserRightBanned,
} from '../../global/helpers';
import { getIsChatMuted } from '../../global/helpers/notifications';
import {
  selectBot,
  selectCanGift,
  selectCanManage,
  selectCanManageAutoDelete,
  selectCanSendMoneyToUser,
  selectCanTranslateChat,
  selectChat,
  selectChatFullInfo,
  selectChatHistoryTtl,
  selectCurrentMessageList,
  selectIsChatRestricted,
  selectIsChatWithSelf,
  selectIsCurrentUserFrozen,
  selectIsDeletedHidden,
  selectIsRightColumnShown,
  selectNotifyDefaults,
  selectNotifyException,
  selectTabState,
  selectTopic,
  selectUser,
  selectUserFullInfo,
} from '../../global/selectors';
import { isUserId } from '../../util/entities/ids';
import { disableScrolling } from '../../util/scrollLock';
import { isProxyGuest } from '../../api/proxy';
import { runProxyJob } from '../../api/proxy/outbox';
import { getPxgErrorMessage } from '../../proxygram/errorReasons';
import { getPxgState, setPxgState, usePxgState } from '../../proxygram/server/store'; // PXG
import { buildAutoDeletePeriodOptions, DEFAULT_AUTO_DELETE_PERIODS } from '../common/helpers/autoDeletePeriods';

import useAppLayout from '../../hooks/useAppLayout';
import useFlag from '../../hooks/useFlag';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import usePrevDuringAnimation from '../../hooks/usePrevDuringAnimation';
import useShowTransitionDeprecated from '../../hooks/useShowTransitionDeprecated';

import DeleteChatModal from '../common/DeleteChatModal';
import AutoDeleteOutlinedIcon from '../common/icons/AutoDeleteOutlinedIcon';
import Icon from '../common/icons/Icon';
import MuteChatModal from '../left/MuteChatModal.async';
import ConfirmDialog from '../ui/ConfirmDialog';
import Menu from '../ui/Menu';
import MenuItem from '../ui/MenuItem';
import MenuSeparator from '../ui/MenuSeparator';
import NestedMenuItem from '../ui/NestedMenuItem';
import Portal from '../ui/Portal';

import './HeaderMenuContainer.scss';

const BOT_BUTTONS: Record<string, { icon: IconName; label: RegularLangKey }> = {
  settings: {
    icon: 'bots',
    label: 'BotSettings',
  },
  help: {
    icon: 'help',
    label: 'BotHelp',
  },
};

export type OwnProps = {
  chatId: string;
  threadId: ThreadId;
  isOpen: boolean;
  anchor: IAnchorPosition;
  isChannel?: boolean;
  canSubscribe?: boolean;
  canSearch?: boolean;
  canCall?: boolean;
  canMute?: boolean;
  canViewStatistics?: boolean;
  canViewBoosts?: boolean;
  canViewMonetization?: boolean;
  canShowBoostModal?: boolean;
  withForumActions?: boolean;
  canLeave?: boolean;
  canEnterVoiceChat?: boolean;
  canCreateVoiceChat?: boolean;
  pendingJoinRequests?: number;
  canTranslate?: boolean;
  channelMonoforumId?: string;
  onSearchClick: () => void;
  onAsMessagesClick: () => void;
  onReadForOwner?: () => void;
  onClose: () => void;
  onCloseAnimationEnd: () => void;
  onJoinRequestsClick?: () => void;
};

type StateProps = {
  chat?: ApiChat;
  botCommands?: ApiBotCommand[];
  botPrivacyPolicyUrl?: string;
  isPrivate?: boolean;
  isMuted?: boolean;
  isTopic?: boolean;
  isForum?: boolean;
  isBotForum?: boolean;
  isForumAsMessages?: true;
  canAddContact?: boolean;
  canDeleteChat?: boolean;
  canHideDeleted?: boolean;
  isDeletedHidden?: boolean;
  canReportChat?: boolean;
  canGift?: boolean;
  canSendMoney?: boolean;
  canCreateTopic?: boolean;
  canEditTopic?: boolean;
  hasLinkedChat?: boolean;
  isChatInfoShown?: boolean;
  isRightColumnShown?: boolean;
  canManage?: boolean;
  canTranslate?: boolean;
  isBlocked?: boolean;
  isBot?: boolean;
  isChatWithSelf?: boolean;
  savedDialog?: ApiChat;
  disallowedGifts?: ApiDisallowedGifts;
  isAccountFrozen?: boolean;
  noForwardsMyEnabled?: boolean;
  noForwardsPeerEnabled?: boolean;
  canManageAutoDelete?: boolean;
  historyTtl?: number;
  canEditPersonalContact?: boolean;
  canChangeGuestList?: boolean;
};

const CLOSE_MENU_ANIMATION_DURATION = 200;

const HeaderMenuContainer = ({
  chatId,
  threadId,
  isOpen,
  anchor,
  isChannel,
  canSubscribe,
  botCommands,
  botPrivacyPolicyUrl,
  withForumActions,
  isTopic,
  isForum,
  isBotForum,
  isForumAsMessages,
  isChatInfoShown,
  canReportChat,
  canSearch,
  canCall,
  canMute,
  canViewStatistics,
  canViewMonetization,
  canViewBoosts,
  pendingJoinRequests,
  canLeave,
  canEnterVoiceChat,
  canCreateVoiceChat,
  chat,
  isPrivate,
  isMuted,
  canDeleteChat,
  canHideDeleted,
  isDeletedHidden,
  canGift,
  canSendMoney,
  hasLinkedChat,
  canAddContact,
  canCreateTopic,
  canEditTopic,
  canManage,
  isRightColumnShown,
  canTranslate,
  isBlocked,
  isBot,
  isChatWithSelf,
  savedDialog,
  canShowBoostModal,
  disallowedGifts,
  isAccountFrozen,
  noForwardsMyEnabled,
  noForwardsPeerEnabled,
  canManageAutoDelete,
  historyTtl,
  canEditPersonalContact,
  canChangeGuestList,
  channelMonoforumId,
  onJoinRequestsClick,
  onSearchClick,
  onAsMessagesClick,
  onReadForOwner,
  onClose,
  onCloseAnimationEnd,
}: OwnProps & StateProps) => {
  const {
    updateChatMutedState,
    setSettingOption,
    enterMessageSelectMode,
    sendBotCommand,
    restartBot,
    requestMasterAndJoinGroupCall,
    createGroupCall,
    joinChannel,
    openLinkedChat,
    openAddContactDialog,
    openFrozenAccountModal,
    requestMasterAndRequestCall,
    toggleStatistics,
    openMonetizationStatistics,
    openBoostStatistics,
    openGiftModal,
    openThreadWithInfo,
    openCreateTopicPanel,
    openEditTopicPanel,
    openChat,
    openUrl,
    toggleManagement,
    togglePeerTranslations,
    blockUser,
    unblockUser,
    setViewForumAsMessages,
    openBoostModal,
    reportMessages,
    showNotification,
    toggleNoForwards,
    openDisableSharingAboutModal,
    setChatHistoryTtl,
    openAutoDeleteTimerModal,
    openWalletTransferLink,
    markChatUnread,
    toggleChatArchived,
  } = getActions();

  const lang = useLang();

  const { isMobile } = useAppLayout();
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const [shouldCloseFast, setShouldCloseFast] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isMuteModalOpen, setIsMuteModalOpen] = useState(false);
  const [ownerChatChange, setOwnerChatChange] = useState<OwnerChatChange>();
  const [isApplyingOwnerChange, setIsApplyingOwnerChange] = useState(false);
  const ownerChangeInFlightRef = useRef(false);
  const [shouldRenderMuteModal, markRenderMuteModal, unmarkRenderMuteModal] = useFlag();
  const { x, y } = anchor;

  useShowTransitionDeprecated(isOpen, onCloseAnimationEnd, undefined, false);
  const isViewGroupInfoShown = usePrevDuringAnimation(
    (!isChatInfoShown && isForum) ? true : undefined, CLOSE_MENU_ANIMATION_DURATION,
  );
  const viewInfoLangKey = getViewInfoLangKey(isTopic, isBotForum);

  const areAllGiftsDisallowed = useMemo(() => {
    if (!disallowedGifts) {
      return undefined;
    }
    return Object.values(disallowedGifts).every(Boolean);
  }, [disallowedGifts]);

  const closeMuteModal = useLastCallback(() => {
    setIsMuteModalOpen(false);
    onClose();
  });

  const handleReport = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      setIsMenuOpen(false);
      reportMessages({ chatId, messageIds: [] });
    }
    onClose();
  });

  const handleDelete = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
      onClose();
    } else {
      setIsDeleteModalOpen(true);
    }
    setIsMenuOpen(false);
  });

  const closeMenu = useLastCallback(() => {
    setIsMenuOpen(false);
    onClose();
  });

  const chooseOwnerChatChange = useLastCallback((change: OwnerChatChange) => {
    setOwnerChatChange(change);
    setIsMenuOpen(false);
  });

  const closeOwnerChatChange = useLastCallback(() => {
    if (ownerChangeInFlightRef.current) return;
    setOwnerChatChange(undefined);
    onClose();
  });

  const ownerChat = threadId === MAIN_THREAD_ID ? chat?.pxgProxy : undefined;
  const ownerChatActions = ownerChat?.ownerChatActions ?? [];
  const applyOwnerChatChange = useLastCallback(async () => {
    const change = ownerChatChange;
    if (!change || !ownerChat?.ownerChatActions?.includes(change.operation) || ownerChangeInFlightRef.current) return;
    const userId = getPxgState().session?.user.id;
    ownerChangeInFlightRef.current = true;
    setIsApplyingOwnerChange(true);
    try {
      const result = await runProxyJob('chats.ownerAction', {
        accountId: ownerChat.accountId,
        peerId: ownerChat.peerId,
        change,
      }, 15_000) as { isProtected?: boolean; requestSent?: boolean } | null;
      if (getPxgState().session?.user.id !== userId) return;
      let message = lang('PxgOwnerChatActionDone');
      if (change.operation === 'contentProtection' && !change.enabled) {
        if (result?.requestSent) message = lang('PxgOwnerChatProtectionRequested');
        else if (result?.isProtected !== false) message = lang('PxgOwnerChatProtectionStillOn');
      }
      showNotification({ message });
    } catch (err) {
      if (getPxgState().session?.user.id === userId) {
        showNotification({ message: getPxgErrorMessage(lang, err) });
      }
    } finally {
      ownerChangeInFlightRef.current = false;
      setIsApplyingOwnerChange(false);
      closeOwnerChatChange();
    }
  });

  const handleViewGroupInfo = useLastCallback(() => {
    openThreadWithInfo({ chatId, threadId });
    setShouldCloseFast(!isRightColumnShown);
    closeMenu();
  });

  const closeDeleteModal = useLastCallback(() => {
    setIsDeleteModalOpen(false);
    onClose();
  });

  const handleRestartBot = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      restartBot({ chatId });
    }
  });

  const handleUnmuteClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      updateChatMutedState({ chatId, mutedUntil: UNMUTE_TIMESTAMP });
    }
    closeMenu();
  });

  const handleMuteClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
      closeMenu();
    } else {
      markRenderMuteModal();
      setIsMuteModalOpen(true);
    }
    setIsMenuOpen(false);
  });

  const handleCreateTopicClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      openCreateTopicPanel({ chatId });
      setShouldCloseFast(!isRightColumnShown);
    }
    closeMenu();
  });

  const handleEditClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      toggleManagement({ force: true });
      setShouldCloseFast(!isRightColumnShown);
    }
    closeMenu();
  });

  const handleEditTopicClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      openEditTopicPanel({ chatId, topicId: Number(threadId) });
      setShouldCloseFast(!isRightColumnShown);
    }
    closeMenu();
  });

  const handleViewAsTopicsClick = useLastCallback(() => {
    openChat({ id: undefined });
    setViewForumAsMessages({ chatId, isEnabled: false });
    closeMenu();
  });

  const handleEnterVoiceChatClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else if (canCreateVoiceChat) {
      // TODO Show popup to schedule
      createGroupCall({
        chatId,
      });
    } else {
      requestMasterAndJoinGroupCall({
        chatId,
      });
    }
    closeMenu();
  });

  const handleLinkedChatClick = useLastCallback(() => {
    openLinkedChat({ id: chatId });
    closeMenu();
  });

  const handleGiftClick = useLastCallback(() => {
    if (areAllGiftsDisallowed && chat) {
      showNotification({ message: lang('SendDisallowError') });
      return;
    }
    openGiftModal({ forUserId: chatId });
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      openGiftModal({ forUserId: chatId });
    }
    closeMenu();
  });

  const handleSendMoneyClick = useLastCallback(() => {
    openWalletTransferLink({ userId: chatId, shouldCloseAfterSend: true });
    closeMenu();
  });

  const handleAddContactClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      openAddContactDialog({ userId: chatId });
    }
    closeMenu();
  });

  const handleVideoCall = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      requestMasterAndRequestCall({ userId: chatId, isVideo: true });
    }
    closeMenu();
  });

  const handleCall = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      requestMasterAndRequestCall({ userId: chatId });
    }
    closeMenu();
  });

  const handleSearch = useLastCallback(() => {
    onSearchClick();
    closeMenu();
  });

  const handleStatisticsClick = useLastCallback(() => {
    toggleStatistics();
    setShouldCloseFast(!isRightColumnShown);
    closeMenu();
  });

  const handleMonetizationClick = useLastCallback(() => {
    openMonetizationStatistics({ chatId });
    setShouldCloseFast(!isRightColumnShown);
    closeMenu();
  });

  const handleBoostClick = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else if (canViewBoosts) {
      openBoostStatistics({ chatId });
      setShouldCloseFast(!isRightColumnShown);
    } else {
      openBoostModal({ chatId });
    }
    closeMenu();
  });

  const handleEnableTranslations = useLastCallback(() => {
    togglePeerTranslations({ chatId, isEnabled: true });
    closeMenu();
  });

  const handleSelectMessages = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      enterMessageSelectMode();
    }
    closeMenu();
  });

  const handleOpenAsMessages = useLastCallback(() => {
    onAsMessagesClick();
    closeMenu();
  });

  const handleBlock = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      blockUser({ userId: chatId });
    }
    closeMenu();
  });

  const handleUnblock = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      unblockUser({ userId: chatId });
    }
    closeMenu();
  });

  const handleToggleNoForwards = useLastCallback(() => {
    closeMenu();
    if (isAccountFrozen) {
      openFrozenAccountModal();
      return;
    }

    if (noForwardsMyEnabled || noForwardsPeerEnabled) {
      toggleNoForwards({ userId: chatId, isEnabled: false });
      return;
    }

    openDisableSharingAboutModal({ userId: chatId });
  });

  const handleSubscribe = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      joinChannel({ chatId });
    }
    closeMenu();
  });

  const handleAutoDeletePeriodSelect = useLastCallback((e: React.SyntheticEvent, period?: number) => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else if (period !== (historyTtl ?? 0)) {
      setChatHistoryTtl({ chatId, period: period! });
    }
    closeMenu();
  });

  const handleSetCustomAutoDeleteTime = useLastCallback(() => {
    if (isAccountFrozen) {
      openFrozenAccountModal();
    } else {
      openAutoDeleteTimerModal({ chatId });
    }
    closeMenu();
  });

  const handleSendChannelMessage = useLastCallback(() => {
    openChat({ id: channelMonoforumId });
    closeMenu();
  });

  useEffect(disableScrolling, []);

  const autoDeleteOptions = useMemo(() => {
    if (!canManageAutoDelete) return undefined;

    return buildAutoDeletePeriodOptions(lang, DEFAULT_AUTO_DELETE_PERIODS, historyTtl, lang('AutoDeleteNever'));
  }, [canManageAutoDelete, historyTtl, lang]);

  const botButtons = useMemo(() => {
    const commandButtons = botCommands?.map((botCommand) => {
      const { command } = botCommand;
      const cmd = BOT_BUTTONS[command];
      if (!cmd) return undefined;

      const handleClick = () => {
        sendBotCommand({
          command: `/${command}`,
          botId: botCommand.botId,
        });
        closeMenu();
      };

      return (
        <MenuItem
          key={command}
          icon={cmd.icon}

          onClick={handleClick}
        >
          <span className="ephemeral-command-label">
            {lang(cmd.label)}
            {botCommand.isEphemeral && (
              <Icon
                name="eye-outline"
                className="ephemeral-command-icon"
                ariaLabel={lang('EphemeralOnlyVisible')}
              />
            )}
          </span>
        </MenuItem>
      );
    });

    const hasPrivacyCommand = botCommands?.some(({ command }) => command === 'privacy');

    const privacyButton = isBot && (
      <MenuItem
        icon="privacy-policy"

        onClick={() => {
          if (hasPrivacyCommand && !botPrivacyPolicyUrl) {
            sendBotCommand({ command: '/privacy' });
          } else {
            openUrl({ url: botPrivacyPolicyUrl || lang('BotDefaultPrivacyPolicy') });
          }
          closeMenu();
        }}
      >
        {lang('MenuPrivacyPolicy')}
      </MenuItem>
    );

    return [...commandButtons || [], privacyButton].filter(Boolean);
  }, [botCommands, lang, botPrivacyPolicyUrl, isBot]);

  const hasPxgSession = usePxgState((state) => state.session?.level === 'client'); // PXG
  const isSharedChat = Boolean(chat?.pxgProxy);

  const deleteTitle = useMemo(() => {
    if (!chat) return undefined;

    if (savedDialog) {
      return lang('Delete');
    }

    if (isPrivate) {
      return lang('DeleteChat');
    }

    if (canDeleteChat) {
      return lang('GroupInfoDeleteAndExit');
    }

    if (isChannel) {
      return lang('ChannelLeave');
    }

    return lang('GroupLeaveGroup');
  }, [canDeleteChat, chat, isChannel, isPrivate, savedDialog, lang]);

  return (
    <Portal>
      <div className="HeaderMenuContainer">
        <Menu
          isOpen={isMenuOpen}
          positionX="right"
          style={`left: ${x}px;top: ${y}px;`}
          onClose={closeMenu}
          shouldCloseFast={shouldCloseFast}
        >
          {isMobile && canSearch && (
            <MenuItem
              icon="search"
              onClick={handleSearch}
            >
              {lang('Search')}
            </MenuItem>
          )}
          {withForumActions && canCreateTopic && (
            <>
              <MenuItem
                icon="message"
                onClick={handleCreateTopicClick}
              >
                {lang('ForumCreateTopic')}
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          {canSubscribe && (
            <MenuItem
              icon={isChannel ? 'channel' : 'group'}
              onClick={handleSubscribe}
            >
              {lang(isChannel ? 'ProfileJoinChannel' : 'ProfileJoinGroup')}
            </MenuItem>
          )}
          {channelMonoforumId && (
            <MenuItem
              icon="message"
              onClick={handleSendChannelMessage}
            >
              {lang('ChannelSendMessage')}
            </MenuItem>
          )}
          {isViewGroupInfoShown && (
            <MenuItem
              icon="info"
              onClick={handleViewGroupInfo}
            >
              {lang(viewInfoLangKey)}
            </MenuItem>
          )}
          {/* PXG: открыть чат гостю через сервер Proxygram */}
          {hasPxgSession && chat && !isSharedChat && !savedDialog && chatId !== SERVICE_NOTIFICATIONS_USER_ID && (
            <MenuItem
              icon="share-filled"
              onClick={() => {
                setPxgState({ shareChatId: chatId, shareFolder: undefined, shareTopic: undefined });
                closeMenu();
              }}
            >
              {lang('PxgShareTitle')}
            </MenuItem>
          )}
          {/* PXG: удалённые сообщения остаются в ленте, пока их не скроют */}
          {canHideDeleted && (
            <MenuItem
              icon="delete"
              onClick={() => {
                const { pxgHideDeletedChats } = getGlobal().settings.byKey;
                setSettingOption({ pxgHideDeletedChats: { ...pxgHideDeletedChats, [chatId]: !isDeletedHidden } });
                closeMenu();
              }}
            >
              {lang(isDeletedHidden ? 'PxgShowDeleted' : 'PxgHideDeleted')}
            </MenuItem>
          )}
          {/* PXG: открыть гостю только эту тему форума */}
          {hasPxgSession && !isSharedChat && isTopic && (
            <MenuItem
              icon="share-filled"
              onClick={() => {
                const topicId = Number(threadId);
                const title = selectTopic(getGlobal(), chatId, topicId)?.title || String(topicId);
                setPxgState({ shareChatId: chatId, shareFolder: undefined, shareTopic: { id: topicId, title } });
                closeMenu();
              }}
            >
              {lang('PxgShareTopic')}
            </MenuItem>
          )}
          {canManage && !canEditTopic && (
            <MenuItem
              icon="edit"
              onClick={handleEditClick}
            >
              {lang('Edit')}
            </MenuItem>
          )}
          {canEditPersonalContact && (
            <MenuItem
              icon="edit"
              onClick={() => {
                setPxgState({ personalContactUserId: chatId });
                closeMenu();
              }}
            >
              {lang('PxgContactEdit')}
            </MenuItem>
          )}
          {canEditTopic && (
            <MenuItem
              icon="edit"
              onClick={handleEditTopicClick}
            >
              {lang('ForumTopicEdit')}
            </MenuItem>
          )}
          {isMobile && !withForumActions && isForum && !isBotForum && !isTopic && (
            <MenuItem
              icon="forums"
              onClick={handleViewAsTopicsClick}
            >
              {lang('ChatContextViewAsTopics')}
            </MenuItem>
          )}
          {withForumActions && Boolean(pendingJoinRequests) && (
            <MenuItem
              icon="user"
              onClick={onJoinRequestsClick}
            >
              {isChannel ? lang('SubscribeRequests') : lang('MemberRequests')}
              <div className="right-badge">{pendingJoinRequests}</div>
            </MenuItem>
          )}
          {withForumActions && !isTopic && !isBotForum && !isForumAsMessages && (
            <MenuItem
              icon="message"
              onClick={handleOpenAsMessages}
            >
              {lang('ForumViewAsMessages')}
            </MenuItem>
          )}
          {canShowBoostModal && !canViewBoosts && (
            <MenuItem
              icon="boost-outline"
              onClick={handleBoostClick}
            >
              {lang(isChannel ? 'BoostingBoostChannelMenu' : 'BoostingBoostGroupMenu')}
            </MenuItem>
          )}
          {canAddContact && (
            <MenuItem
              icon="add-user"
              onClick={handleAddContactClick}
            >
              {lang('AddContact')}
            </MenuItem>
          )}
          {isMobile && canCall && (
            <MenuItem
              icon="phone"
              onClick={handleCall}
            >
              {lang('Call')}
            </MenuItem>
          )}
          {canCall && (
            <MenuItem
              icon="video-outlined"
              onClick={handleVideoCall}
            >
              {lang('VideoCall')}
            </MenuItem>
          )}
          {canMute && (isMuted ? (
            <MenuItem
              icon="unmute"
              onClick={handleUnmuteClick}
            >
              {lang(isSharedChat ? 'PxgGuestUnmute' : 'ChatsUnmute')}
            </MenuItem>
          )
            : (
              <MenuItem
                icon="mute"
                onClick={handleMuteClick}
              >
                {lang(isSharedChat ? 'PxgGuestMute' : 'ChatsMute')}
                ...
              </MenuItem>
            )
          )}
          {autoDeleteOptions && (
            <NestedMenuItem
              customIcon={<AutoDeleteOutlinedIcon period={historyTtl ?? 0} />}
              submenu={(
                <>
                  {autoDeleteOptions.map(({ label, value }) => {
                    const period = Number(value);
                    return (
                      <MenuItem
                        key={value}
                        icon={period === (historyTtl ?? 0) ? 'check' : 'placeholder'}
                        clickArg={period}
                        onClick={handleAutoDeletePeriodSelect}
                      >
                        {label}
                      </MenuItem>
                    );
                  })}
                  <MenuItem
                    icon="tools"
                    onClick={handleSetCustomAutoDeleteTime}
                  >
                    {lang('SetCustomTime')}
                  </MenuItem>
                </>
              )}
            >
              {lang('AutoDeletePopupTitle')}
            </NestedMenuItem>
          )}
          {(canEnterVoiceChat || canCreateVoiceChat) && (
            <MenuItem
              icon="voice-chat"
              onClick={handleEnterVoiceChatClick}
            >
              {lang(canCreateVoiceChat ? 'StartVoipChat' : 'VoipGroupJoinCall')}
            </MenuItem>
          )}
          {hasLinkedChat && (
            <MenuItem
              icon={isChannel ? 'message' : 'channel'}
              onClick={handleLinkedChatClick}
            >
              {lang(isChannel ? 'ViewDiscussion' : 'ProfileViewChannel')}
            </MenuItem>
          )}
          {!withForumActions && (
            <MenuItem
              icon="select"
              onClick={handleSelectMessages}
            >
              {lang('ReportSelectMessages')}
            </MenuItem>
          )}
          {canChangeGuestList && chat && (
            <>
              <MenuItem
                icon="readchats"
                onClick={() => {
                  markChatUnread({ id: chatId });
                  closeMenu();
                }}
              >
                {lang('ChatListContextMarkAsUnread')}
              </MenuItem>
              <MenuItem
                icon={isChatArchived(chat) ? 'unarchive' : 'archive'}
                onClick={() => {
                  toggleChatArchived({ id: chatId });
                  closeMenu();
                }}
              >
                {lang(isChatArchived(chat) ? 'PxgGuestUnarchiveChat' : 'PxgGuestArchiveChat')}
              </MenuItem>
            </>
          )}
          {onReadForOwner && (
            <MenuItem
              icon="readchats"
              onClick={() => {
                closeMenu();
                onReadForOwner();
              }}
            >
              {lang('PxgReadOwnerAction')}
            </MenuItem>
          )}
          {ownerChatActions.length > 0 && (
            <>
              <MenuSeparator />
              {ownerChatActions.includes('autoDelete') && (
                <NestedMenuItem
                  customIcon={<AutoDeleteOutlinedIcon period={0} />}
                  submenu={buildAutoDeletePeriodOptions(lang, DEFAULT_AUTO_DELETE_PERIODS, undefined,
                    lang('AutoDeleteNever')).map(({ label, value }) => (
                    <MenuItem
                      key={value}
                      onClick={() => chooseOwnerChatChange({ operation: 'autoDelete', period: Number(value) })}
                    >
                      {label}
                    </MenuItem>
                  ))}
                >
                  {lang('PxgOwnerChatAutoDelete')}
                </NestedMenuItem>
              )}
              {ownerChatActions.includes('contentProtection') && (
                <MenuItem
                  icon={chat?.isProtected ? 'allow-share' : 'no-share'}
                  onClick={() => chooseOwnerChatChange({ operation: 'contentProtection', enabled: !chat?.isProtected })}
                >
                  {lang(chat?.isProtected ? 'PxgOwnerChatAllowCopy' : 'PxgOwnerChatProtectCopy')}
                </MenuItem>
              )}
              {ownerChatActions.includes('contactBlock') && (
                <NestedMenuItem
                  icon="hand-stop"
                  submenu={(
                    <>
                      <MenuItem
                        destructive
                        onClick={() => chooseOwnerChatChange({ operation: 'contactBlock', enabled: true })}
                      >
                        {lang('NewContactBlock')}
                      </MenuItem>
                      <MenuItem onClick={() => chooseOwnerChatChange({ operation: 'contactBlock', enabled: false })}>
                        {lang('Unblock')}
                      </MenuItem>
                    </>
                  )}
                >
                  {lang('PxgOwnerChatContactBlock')}
                </NestedMenuItem>
              )}
            </>
          )}
          {canViewBoosts && (
            <MenuItem
              icon="boost-outline"
              onClick={handleBoostClick}
            >
              {lang('Boosts')}
            </MenuItem>
          )}
          {canViewStatistics && (
            <MenuItem
              icon="stats"
              onClick={handleStatisticsClick}
            >
              {lang('Statistics')}
            </MenuItem>
          )}
          {isChannel && canViewMonetization && (
            <MenuItem
              icon="cash-circle"
              onClick={handleMonetizationClick}
            >
              {lang('ChannelEarnTitle')}
            </MenuItem>
          )}
          {canTranslate && (
            <MenuItem
              icon="language"
              onClick={handleEnableTranslations}
            >
              {lang('AiMessageEditorTranslate')}
            </MenuItem>
          )}
          {canReportChat && (
            <MenuItem
              icon="flag"
              onClick={handleReport}
            >
              {lang('ReportPeerReport')}
            </MenuItem>
          )}
          {botButtons}
          {canGift && (
            <MenuItem
              icon="gift"
              onClick={handleGiftClick}
            >
              {lang('ProfileSendAGift')}
            </MenuItem>
          )}
          {canSendMoney && (
            <MenuItem
              icon="gram-outline"
              onClick={handleSendMoneyClick}
            >
              {lang('WalletSendMoney')}
            </MenuItem>
          )}
          {isBot && (
            <MenuItem
              icon={isBlocked ? 'bots' : 'hand-stop'}
              onClick={isBlocked ? handleRestartBot : handleBlock}
            >
              {isBlocked ? lang('BotRestart') : lang('BotStop')}
            </MenuItem>
          )}
          {isPrivate && !isSharedChat && !isChatWithSelf && !isBot && (
            <MenuItem
              icon={noForwardsMyEnabled || noForwardsPeerEnabled ? 'allow-share' : 'no-share'}
              onClick={handleToggleNoForwards}
            >
              {noForwardsMyEnabled || noForwardsPeerEnabled ? lang('EnableSharing') : lang('DisableSharing')}
            </MenuItem>
          )}
          {isPrivate && !isSharedChat && !isChatWithSelf && !isBot && (
            <MenuItem
              icon={isBlocked ? 'user' : 'hand-stop'}
              onClick={isBlocked ? handleUnblock : handleBlock}
            >
              {isBlocked ? lang('Unblock') : lang('NewContactBlock')}
            </MenuItem>
          )}
          {canLeave && (
            <>
              <MenuSeparator />
              <MenuItem
                destructive
                icon="delete"
                onClick={handleDelete}
              >
                {deleteTitle}
              </MenuItem>
            </>
          )}
        </Menu>
        {ownerChatChange && (
          <ConfirmDialog
            isOpen
            title={lang('PxgOwnerChatConfirmTitle')}
            text={lang(getOwnerChatConfirmation(ownerChatChange))}
            confirmIsDestructive={ownerChatChange.operation === 'contactBlock' && ownerChatChange.enabled}
            isConfirmDisabled={!ownerChatActions.includes(ownerChatChange.operation)}
            isConfirmLoading={isApplyingOwnerChange}
            confirmHandler={applyOwnerChatChange}
            onClose={closeOwnerChatChange}
          />
        )}
        {chat && !isSharedChat && (
          <DeleteChatModal
            isOpen={isDeleteModalOpen}
            onClose={closeDeleteModal}
            chat={savedDialog || chat}
            isSavedDialog={Boolean(savedDialog)}
          />
        )}
        {canMute && shouldRenderMuteModal && chat?.id && (
          <MuteChatModal
            isOpen={isMuteModalOpen}
            onClose={closeMuteModal}
            onCloseAnimationEnd={unmarkRenderMuteModal}
            chatId={chat.id}
          />
        )}
      </div>
    </Portal>
  );
};

function getOwnerChatConfirmation(change: OwnerChatChange): RegularLangKey {
  switch (change.operation) {
    case 'autoDelete': return change.period ? 'PxgOwnerChatConfirmTtlOn' : 'PxgOwnerChatConfirmTtlOff';
    case 'contentProtection': return change.enabled ? 'PxgOwnerChatConfirmProtect' : 'PxgOwnerChatConfirmUnprotect';
    case 'contactBlock': return change.enabled ? 'PxgOwnerChatConfirmBlock' : 'PxgOwnerChatConfirmUnblock';
  }
}

function getViewInfoLangKey(isTopic: boolean | undefined, isBotForum: boolean | undefined) {
  if (isTopic) {
    return 'HeaderMenuViewTopicInfo';
  }

  if (isBotForum) {
    return 'HeaderMenuViewProfile';
  }

  return 'HeaderMenuViewGroupInfo';
}

export default memo(withGlobal<OwnProps>(
  (global, { chatId, threadId }): Complete<StateProps> => {
    const chat = selectChat(global, chatId);
    const isRestricted = selectIsChatRestricted(global, chatId);
    if (!chat || isRestricted) {
      return {} as Complete<StateProps>;
    }
    const isPrivate = isUserId(chat.id);
    const user = isPrivate ? selectUser(global, chatId) : undefined;
    const canAddContact = user && getCanAddContact(user);
    const isMainThread = threadId === MAIN_THREAD_ID;
    const isChatWithSelf = selectIsChatWithSelf(global, chatId);
    const { chatId: currentChatId, threadId: currentThreadId } = selectCurrentMessageList(global) || {};
    const canReportChat = isMainThread && !user && (isChatChannel(chat) || isChatGroup(chat)) && !isChatAdmin(chat);

    const chatBot = !isSystemBot(chatId) ? selectBot(global, chatId) : undefined;
    const userFullInfo = isPrivate ? selectUserFullInfo(global, chatId) : undefined;
    const chatFullInfo = !isPrivate ? selectChatFullInfo(global, chatId) : undefined;
    const fullInfo = userFullInfo || chatFullInfo;
    const canGift = selectCanGift(global, chatId);

    const topic = selectTopic(global, chatId, threadId);
    // Disable manual creation for bot forums
    const canCreateTopic = chat.isForum && !chat.isBotForum && (
      !isUserRightBanned(chat, 'manageTopics') || getHasAdminRight(chat, 'manageTopics')
    );
    const canEditTopic = topic && getCanManageTopic(chat, topic);
    const canManage = selectCanManage(global, chatId);
    // Context menu item should only be displayed if user hid translation panel
    const canTranslate = selectCanTranslateChat(global, chatId) && fullInfo?.isTranslationDisabled;

    if (chat.pxgProxy) {
      const proxy = chat.pxgProxy;
      const isTopic = Boolean(chat.isForum && !isMainThread);
      const topicRights = isTopic ? topic?.pxgPermissions : proxy.permissions;
      const isEditable = !proxy.restricted && !proxy.isLocal;
      return {
        chat,
        isMuted: getIsChatMuted(chat, selectNotifyDefaults(global), selectNotifyException(global, chatId)),
        isTopic,
        isForum: chat.isForum,
        isForumAsMessages: chat.isForumAsMessages,
        canHideDeleted: topicRights?.seeArchive && !proxy.isLocal,
        isDeletedHidden: selectIsDeletedHidden(global, chatId),
        isChatInfoShown: selectTabState(global).chatInfo.isOpen
          && currentChatId === chatId && currentThreadId === threadId,
        canCreateTopic: isEditable && isMainThread && proxy.canAdministerChat && canCreateTopic,
        canEditTopic: isEditable && topicRights?.admin && canEditTopic,
        canManage: isEditable && isMainThread && canManage,
        canEditPersonalContact: isPrivate && Boolean(user) && proxy.peerId > 0
          && !proxy.isLocal && !proxy.isSavedMessages,
        canChangeGuestList: isMainThread && isProxyGuest() && !proxy.isLocal && !proxy.isSavedMessages,
        isRightColumnShown: selectIsRightColumnShown(global),
        canTranslate,
      } as Complete<StateProps>;
    }

    const isSavedDialog = getIsSavedDialog(chatId, threadId, global.currentUserId);
    const savedDialog = isSavedDialog ? selectChat(global, String(threadId)) : undefined;
    const isAccountFrozen = selectIsCurrentUserFrozen(global);
    const chatInfo = selectTabState(global).chatInfo;
    const canManageAutoDelete = isMainThread && !isSavedDialog && selectCanManageAutoDelete(global, chatId);

    return {
      chat,
      isMuted: getIsChatMuted(chat, selectNotifyDefaults(global), selectNotifyException(global, chat.id)),
      isPrivate,
      isTopic: chat?.isForum && !isMainThread,
      isForum: chat?.isForum,
      isBotForum: chat?.isBotForum,
      isForumAsMessages: chat?.isForumAsMessages,
      canAddContact,
      canDeleteChat: getCanDeleteChat(chat),
      canHideDeleted: true,
      isDeletedHidden: selectIsDeletedHidden(global, chatId),
      canReportChat,
      canGift,
      canSendMoney: selectCanSendMoneyToUser(global, chatId),
      hasLinkedChat: Boolean(chatFullInfo?.linkedChatId),
      botCommands: chatBot ? userFullInfo?.botInfo?.commands : undefined,
      botPrivacyPolicyUrl: chatBot ? userFullInfo?.botInfo?.privacyPolicyUrl : undefined,
      isChatInfoShown: chatInfo.isOpen && currentChatId === chatId && currentThreadId === threadId,
      canCreateTopic,
      canEditTopic,
      canManage,
      isRightColumnShown: selectIsRightColumnShown(global),
      canTranslate,
      isBlocked: userFullInfo?.isBlocked,
      isBot: Boolean(chatBot),
      isChatWithSelf,
      savedDialog,
      disallowedGifts: userFullInfo?.disallowedGifts,
      isAccountFrozen,
      noForwardsMyEnabled: userFullInfo?.noForwardsMyEnabled,
      noForwardsPeerEnabled: userFullInfo?.noForwardsPeerEnabled,
      canManageAutoDelete,
      historyTtl: canManageAutoDelete ? selectChatHistoryTtl(global, chatId) : undefined,
      canEditPersonalContact: undefined,
      canChangeGuestList: undefined,
    };
  },
)(HeaderMenuContainer));
