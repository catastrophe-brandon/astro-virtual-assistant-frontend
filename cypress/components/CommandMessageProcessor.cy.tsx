import { commandMessageProcessor } from '../../src/SharedComponents/AstroVirtualAssistant/CommandMessageProcessor';
import { CommandType } from '../../src/types/Command';
import { AssistantMessage, From } from '../../src/types/Message';
import React, { useEffect } from 'react';
import { ChromeUser } from '@redhat-cloud-services/types';
import { MessageProcessorOptions } from '../../src/types/Common';


const BASIC_MESSAGE : AssistantMessage = {
  from: From.ASSISTANT,
  content: null,
  messageId: '1',
  isLoading: false,
};


const CommandMessageProcessor: React.FC<{ message: AssistantMessage; options: any }> = ({ message, options }) => {
  useEffect(() => {
    commandMessageProcessor(message, options).catch((e) => {console.error(e)});
  }, [message, options]);

  return <div>CommandMessageProcessor Test</div>;
};

const CommandMessageProcessorWrapper: React.FC<{ message: AssistantMessage; options: MessageProcessorOptions }> = ({ message, options }) => {
  return (<CommandMessageProcessor message={message} options={options} />);
}

// Chrome context mock
const createOptions = () => {
  const user: ChromeUser = {
    identity: {
      user: {
        username: 'test',
        email: '<EMAIL>',
        first_name: 'Test',
        last_name: 'User',
        is_internal: false,
        is_active: true,
        is_org_admin: true,
        locale: 'en-US'
      },
      org_id: '',
      type: ''
    },
    entitlements: {}
  }

  const options: MessageProcessorOptions = {
    addSystemMessage: cy.stub(),
    addBanner: cy.stub(),
    addThumbMessage: cy.stub(),
    toggleFeedbackModal: cy.stub(),
    isPreview: false,
    auth: {
      getUser: async () => Promise.resolve(user),
      getToken: async () => Promise.resolve('token'),
      getOfflineToken: function(): Promise<any> {
        throw new Error('Function not implemented.');
      },
      getRefreshToken: function(): Promise<string> {
        throw new Error('Function not implemented.');
      },
      login: function(): Promise<any> {
        throw new Error('Function not implemented.');
      },
      logout: function(): void {
        throw new Error('Function not implemented.');
      },
      qe: undefined,
      reAuthWithScopes: function(...scopes: string[]): Promise<void> {
        throw new Error('Function not implemented.');
      }
    }
  };
  window.insights.chrome.auth = options.auth;
  return options;
};

describe('Basic CommandMessageProcessor functions', () => {
  let options: MessageProcessorOptions;
  beforeEach(() => {
    options = createOptions();
  })
  it('should handle FINISH_CONVERSATION command', async () => {
    const message : AssistantMessage = {
      from: From.ASSISTANT,
      content: null,
      command: {
        type: CommandType.FINISH_CONVERSATION,
        params: { args: [] },
      },
      messageId: '1',
      isLoading: false,
    };

    await commandMessageProcessor(message, options);

    expect(options.addSystemMessage).to.have.been.calledWith('finish_conversation_message', []);
    expect(options.addBanner).to.have.been.calledWith('finish_conversation_banner', []);
  });

  it('should handle REDIRECT command with a valid URL', async () => {
    const message = {
      command: {
        type: CommandType.REDIRECT,
        params: { args: ['https://example.com'] },
      },
      ...BASIC_MESSAGE,
    };

    await commandMessageProcessor(message, options);

    expect(options.addSystemMessage).to.have.been.calledWith('redirect_message', ['https://example.com']);
  });

  it('should log an error for REDIRECT command without a URL', async () => {
    cy.spy(console, 'error').as('consoleError');

    const message = {
      command: {
        type: CommandType.REDIRECT,
        params: { args: [] },
      },
      ...BASIC_MESSAGE,
    };

    await commandMessageProcessor(message, options);

    cy.get('@consoleError').should('be.calledWith', 'URL is required for redirect command');
  });

  it('should log an error for TOUR command with an unknown tour name', async () => {
    cy.spy(console, 'error').as('consoleError');

    const message = {
      command: {
        type: CommandType.TOUR,
        params: { args: ['unknown'] },
      },
      ...BASIC_MESSAGE,
    };

    await commandMessageProcessor(message, options);

    cy.get('@consoleError').should('be.calledWith', 'Unknown tour name: unknown');
  });

  it('should handle FEEDBACK_MODAL command', async () => {
    const message = {
      command: {
        type: CommandType.FEEDBACK_MODAL,
        params: { args: [] },
      },
      ...BASIC_MESSAGE,
    };

    await commandMessageProcessor(message, options);

    expect(options.toggleFeedbackModal).to.have.been.calledWith(true);
  });
});

describe('CommandMessageProcessors that call APIs', () => {
  let options: MessageProcessorOptions;
  beforeEach(() => {
    options = createOptions();
  })

  it('should handle MANAGE_ORG_2FA command successfully', () => {
    cy.intercept('POST', 'https://sso.redhat.com/auth/realms/redhat-external/apis/organizations/v1/my/authentication-policy', {
      statusCode: 200,
      body: {clientId: '12345', name: 'test-name', description: 'test description please', secret: 'secret'},
    }).as('2FAApiSuccess');
    const message = {
      command: {
        type: CommandType.MANAGE_ORG_2FA,
        params: { args: ['true', 'prod'] },
      },
      ...BASIC_MESSAGE,
    };
    cy.mount(<CommandMessageProcessorWrapper message={message} options={options} />);

    cy.wait('@2FAApiSuccess');
    cy.wrap(options.addBanner).should('have.been.calledWith', 'toggle_org_2fa', ['true']);
  });

  it('should handle MANAGE_ORG_2FA command with failure', () => {
    cy.intercept('POST', 'https://sso.redhat.com/auth/realms/redhat-external/apis/organizations/v1/my/authentication-policy', {
      statusCode: 404,
    }).as('2FAApiFailure');

    const message = {
      command: {
        type: CommandType.MANAGE_ORG_2FA,
        params: { args: ['false', 'prod'] },
      },
      ...BASIC_MESSAGE,
    };
    cy.mount(<CommandMessageProcessorWrapper message={message} options={options} />);

    cy.wait('@2FAApiFailure');
    cy.wrap(options.addBanner).should('have.been.calledWith', 'toggle_org_2fa_failed', ['false']);
  });

  it('should handle CREATE_SERVICE_ACCOUNT command successfully', () => {
    cy.intercept('POST', 'https://sso.redhat.com/auth/realms/redhat-external/apis/service_accounts/v1', {
      statusCode: 201,
      body: {clientId: '12345', name: 'test-name', description: 'test description please', secret: 'secret'},
    }).as('serviceAccountAPISuccess');
  
    const message = {
      command: {
        type: CommandType.CREATE_SERVICE_ACCOUNT,
        params: { args: ['test-name', 'test description please', 'prod'] },
      },
      ...BASIC_MESSAGE,
    };
    cy.mount(<CommandMessageProcessorWrapper message={message} options={options} />);

    cy.wait('@serviceAccountAPISuccess');
    cy.wrap(options.addBanner).should('have.been.calledWith', 'create_service_account', [
      'test-name',
      'test description please',
      '12345',
      'secret',
    ]);
  });

  it('should handle CREATE_SERVICE_ACCOUNT command with failure', () => {
    // stage URL without params specified
    cy.intercept('POST', 'https://sso.stage.redhat.com/auth/realms/redhat-external/apis/service_accounts/v1', {
      statusCode: 404,
    }).as('serviceAccountAPIFailure');

    const message = {
      command: {
        type: CommandType.CREATE_SERVICE_ACCOUNT,
        params: { args: [] },
      },
      ...BASIC_MESSAGE,
    };
    cy.mount(<CommandMessageProcessorWrapper message={message} options={options} />);

    cy.wait('@serviceAccountAPIFailure');
    // Use Cypress retry mechanism to wait for async error handling to complete
    cy.wrap(options.addBanner).should('have.been.calledWith', 'create_service_account_failed', []);
  });
});