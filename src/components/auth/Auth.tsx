import '../../global/actions/initial';

import { memo, useEffect } from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { GlobalState } from '../../global/types';

import { IS_TAURI } from '../../util/browser/globalEnvironment';
import { IS_MAC_OS, PLATFORM_ENV } from '../../util/browser/windowEnvironment';
import { signOutPxg } from '../../proxygram/server/session';
import { getPxgState, setPxgState, usePxgState } from '../../proxygram/server/store';

import useCurrentOrPrev from '../../hooks/useCurrentOrPrev';
import useHistoryBack from '../../hooks/useHistoryBack';
import useLang from '../../hooks/useLang';

import AuthChoice from '../proxygram/auth/AuthChoice';
import GuestLogin from '../proxygram/auth/GuestLogin';
import Button from '../ui/Button';
import Transition from '../ui/Transition';
import AuthCode from './AuthCode.async';
import AuthPassword from './AuthPassword.async';
import AuthPhoneNumber from './AuthPhoneNumber';
import AuthQrCode from './AuthQrCode';
import AuthRegister from './AuthRegister.async';

import './Auth.scss';

type StateProps = {
  authState: GlobalState['auth']['state'];
};

const Auth = ({
  authState,
}: StateProps) => {
  const {
    returnToAuthPhoneNumber, goToAuthQrCode,
  } = getActions();

  const isMobile = PLATFORM_ENV === 'iOS' || PLATFORM_ENV === 'Android';

  const handleChangeAuthorizationMethod = () => {
    if (!isMobile) {
      goToAuthQrCode();
    } else {
      returnToAuthPhoneNumber();
    }
  };

  useHistoryBack({
    isActive: (!isMobile && authState === 'authorizationStateWaitPhoneNumber')
      || (isMobile && authState === 'authorizationStateWaitQrCode'),
    onBack: handleChangeAuthorizationMethod,
  });

  // For animation purposes
  const renderingAuthState = useCurrentOrPrev(
    authState !== 'authorizationStateReady' ? authState : undefined,
    true,
  );

  // PXG: сначала выбор способа входа — свой Telegram или гость через бота (PLAN.md, 7.1)
  const lang = useLang();
  const authChoice = usePxgState((state) => state.authChoice);
  const isStartScreen = !renderingAuthState || renderingAuthState === 'authorizationStateWaitPhoneNumber'
    || renderingAuthState === 'authorizationStateWaitQrCode';
  const pxgScreen = isStartScreen && authChoice !== 'telegram' ? (authChoice ?? 'choice') : undefined;

  // Сессия полного входа принадлежит вышедшему аккаунту Telegram — завершаем и её
  useEffect(() => {
    if (getPxgState().session?.level === 'client') signOutPxg();
  }, []);

  function getScreen() {
    if (pxgScreen === 'choice') return <AuthChoice />;
    if (pxgScreen === 'guest') return <GuestLogin />;
    if (isStartScreen) {
      return (
        <div className="pxg-auth-telegram">
          {getTelegramScreen()}
          <Button
            size="smaller"
            round
            color="translucent"
            className="pxg-auth-back"
            iconName="arrow-left"
            ariaLabel={lang('PxgAuthOtherMethod')}
            onClick={() => setPxgState({ authChoice: undefined })}
          />
        </div>
      );
    }
    return getTelegramScreen();
  }

  function getTelegramScreen() {
    switch (renderingAuthState) {
      case 'authorizationStateWaitCode':
        return <AuthCode />;
      case 'authorizationStateWaitPassword':
        return <AuthPassword />;
      case 'authorizationStateWaitRegistration':
        return <AuthRegister />;
      case 'authorizationStateWaitPhoneNumber':
        return <AuthPhoneNumber />;
      case 'authorizationStateWaitQrCode':
        return <AuthQrCode />;
      default:
        return isMobile ? <AuthPhoneNumber /> : <AuthQrCode />;
    }
  }

  function getActiveKey() {
    if (pxgScreen === 'choice') return 10;
    if (pxgScreen === 'guest') return 11;
    switch (renderingAuthState) {
      case 'authorizationStateWaitCode':
        return 0;
      case 'authorizationStateWaitPassword':
        return 1;
      case 'authorizationStateWaitRegistration':
        return 2;
      case 'authorizationStateWaitPhoneNumber':
        return 3;
      case 'authorizationStateWaitQrCode':
        return 4;
      default:
        return isMobile ? 3 : 4;
    }
  }

  return (
    <Transition
      activeKey={getActiveKey()}
      name="fade"
      className="Auth"
      data-tauri-drag-region={IS_TAURI && IS_MAC_OS ? true : undefined}
    >
      {getScreen()}
    </Transition>
  );
};

export default memo(withGlobal(
  (global): Complete<StateProps> => {
    return {
      authState: global.auth.state,
    };
  },
)(Auth));
