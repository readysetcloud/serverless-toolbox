const OpenAI = require('openai');
const { CacheClient, CredentialProvider, Configurations, CacheListFetch } = require('@gomomento/sdk');
const shared = require('/opt/nodejs/index');
const { TopicClient } = require('@gomomento/sdk');

let cacheClient;
let topicClient;
let openai;

const JSON_MODE_MODELS = ['gpt-4-1106-preview', 'gpt-4-vision-preview'];

exports.handler = async (state) => {
  let messages = [];
  await initialize();

  if (state.conversationKey) {
    const previousMessageResponse = await cacheClient.listFetch('chatgpt', state.conversationKey);
    if (previousMessageResponse instanceof CacheListFetch.Hit) {
      messages = previousMessageResponse.valueListString().map(m => JSON.parse(m));
    }
  }

  if (state.systemContext) {
    messages.push({ role: 'system', content: state.systemContext });
  }

  let query = state.query;
  const model = state.model?.toLowerCase() ?? 'gpt-4-0613';
  if (JSON_MODE_MODELS.includes(model) && !state.query.toLowerCase().includes('json')) {
    query += " Structure your answer in JSON format.";
  }

  const newMessage = { role: 'user', content: query };
  messages.push(newMessage);


  try {
    const params = {
      model,
      temperature: .7,
      messages,
      ...state.schema && {
        functions: [{
          name: 'user-schema',
          parameters: state.schema
        }]
      },
      ...(state.outputFormat?.toLowerCase() == 'json' &&
        JSON_MODE_MODELS.includes(model)) && {
        response_format: { type: 'json_object' },
      }
    };

    let message;
    if (state.streamResponse) {
      message = await handleStreamResponse(params, state.conversationKey);
    } else {
      message = await handleRequestResponse(params);
    }


    if (state.conversationKey && state.rememberResponse) {
      await cacheClient.listConcatenateBack('chatgpt', state.conversationKey, [JSON.stringify(newMessage), JSON.stringify(message)]);
    }

    let response = message.content;
    if (state.schema) {
      response = JSON.parse(message.function_call.arguments);
      return { response };
    }

    if (state.trim) {
      const pieces = response.split('\n\n');

      if (pieces.length > 2) {
        const removedText = pieces.slice(1, pieces.length - 2);
        response = removedText.join('\n\n');
        if (!response) {
          response = pieces.join('\n\n');
        }
      }
    } else if (state.trimFront) {
      const pieces = response.split('\n\n');
      if (pieces.length > 2) {
        const removedText = pieces.slice(1);
        response = removedText.join('\n\n');
      }
    }

    switch (state.outputFormat?.toLowerCase()) {
      case 'json':
        response = JSON.parse(response);
        break;
      case 'number':
        response = Number(response);
        break;
      default:
        response = response.toString();
        break;
    }


    return { response };
  } catch (err) {
    if (err.response) {
      console.error({ status: err.response.status, data: err.response.data });
      if (err.response.status == 429) {
        function CustomError(message) {
          this.name = 'RateLimitExceeded';
          this.message = message;
        }

        CustomError.prototype = new Error();
        console.log('Throwing RateLimitExceededError')
        throw new CustomError(err.message);
      }
    } else {
      console.error(err.message);
    }

    throw err;
  }
};

const handleRequestResponse = async (params) => {
  const result = await openai.chat.completions.create(params);

  return result.choices[0].message;
};

const handleStreamResponse = async (params, topicName) => {
  params.stream = true;
  const stream = await openai.beta.chat.completions.stream(params);

  for await (const chunk of stream) {
    const message = chunk.choices[0]?.delta?.content;
    if (message) {
      await topicClient.publish('chatgpt', topicName, message);
    }
  }

  const completion = await stream.finalChatCompletion();
  return completion.choices[0].message;
};

const setupOpenAI = async () => {
  if (!openai) {
    const authToken = await shared.getSecret('openai');
    openai = new OpenAI({ apiKey: authToken });
  }
};

const initialize = async () => {
  await setupCacheClient();
  await setupOpenAI();
};

const setupCacheClient = async () => {
  if (!cacheClient || !topicClient) {
    const apiKey = await shared.getSecret('momento');

    cacheClient = new CacheClient({
      configuration: Configurations.Lambda.latest(),
      credentialProvider: CredentialProvider.fromString({ apiKey }),
      defaultTtlSeconds: Number(process.env.CACHE_TTL)
    });

    topicClient = new TopicClient({
      configuration: Configurations.Lambda.latest(),
      credentialProvider: CredentialProvider.fromString({ apiKey })
    });
  }
};
