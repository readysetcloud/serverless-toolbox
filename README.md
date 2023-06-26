# Serverless Toolbox

If you build serverless projects as a hobby, you might find yourself rebuilding the same utility functions over and over. With serverless, this isn't a problem when it comes to cost, but it does result in some difficulty if you need to make an update to the same function you've implemented 3+ times. 

With the serverless toolbox, you update your utility functions in one place... here. The contained functions are triggered either by event bridge events or are consumed via solving the ARN through SSM parameters, so they are loosely coupled with your projects. Make an update once, and all your projects seamlessly incorporate the changes.

## Deployment

The toolbox is deployed via a SAM template, so if you don't already have it, you will need to install the [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html). Once installed, you can run the following commands in a terminal in the root directory.

```bash
sam build --parallel
sam deploy --guided
```

The `sam deploy --guided` command will walk you through a wizard, asking for deployment variables. Below is a list of deployment variables and which functions they are required for.

### Variables

You are not required to put in any deployment variables. However, if you choose to omit some, certain functions **will not deploy**.

|Variable|Description|Used For|
|--------|-----------|--------|
|SendgridApiKey| API key used for authenticating calls to SendGrid|Send Email function|
|AdminEmail| The email address used to as the "From" address when sending emails|Send Email function|
|MomentoApiToken| API token used for authenticating calls to Momento|Ask ChatGPT function|
|OpenAIApiKey| API key used for authenticaing calls to OpenAI (ChatGPT)|Ask ChatGPT function|

## Functions

### Ask ChatGPT

This function will maintain conversations with ChatGPT for you across invocations and execution environments. Conversations are identified by a `conversationKey` property that stores the chat history in a Momento cache.

#### Arguments

| Name            | Description                                         | Required |
|-----------------|-----------------------------------------------------|----------|
| query           | Prompt to ask ChatGPT                                | Yes      |
| conversationKey | Specifies the conversation key for context tracking. | No       |
| systemContext   | Indicates the perspective you want ChatGPT to answer in     | No       |
| rememberResponse| Determines if the response should be remembered in the conversation history.     | No       |
| trim            | Controls whether trailing and leading whitespace is removed.     | No       |
| trimFront       | Controls whether leading whitespace is removed.      | No       |
| responseSchema  | Defines the schema for ChatGPT to structure the response. | No       |
| outputFormat    | Specifies the desired output format of the response (json or string). | No       |

**Example input**

```json
{
  "conversationKey": "Example",
  "systemContext": "You are a travel agent with 30 years experience",
  "query": "What is the safest place to travel with kids?",
  "rememberResponse": true,
  "schema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "properties": {
      "destination": {
        "type": "string",
        "description": "Location safest to travel."
      },
      "reasoning": {
        "type": "string",
        "description": "Reason why the place is the safest."
      }
    },
    "required": [ "destination", "reasoning"]
  }
}
```

**Example output**

```json
{
  "response": {
    "destination": "Iceland",
    "reasoning": "Known for its stunning landscapes, Iceland offers a safe environment with low crime rates, clean cities, and a focus on child-friendly activities like exploring geothermal pools, waterfalls, and natural wonders"
  }
}
```

**How to Invoke**

This Lambda function is intended to be used synchronously or as part of a workflow. With this in mind, there are no explicit triggers on it, and it must be invoked manually (meaning you need to build it into whatever you're building).

The ARN is exported into an SSM parameter for convenience/loose coupling. Here is an example of a StateMachine resource in SAM that consumes the function.

```yaml
MyFirstStateMachine:
  Type: AWS::Serverless::StateMachine
    Properties:
      Type: STANDARD
      DefinitionUri: workflows/my-definition.asl.json
      DefinitionSubstitutions:
        AskChatGPTFunctionArn: "{{resolve:ssm:/serverless-toolbox/ask-chatgpt}}"
      Policies:
        - Version: 2012-10-17
          Statement:
            Effect: Allow
            Action: lambda:InvokeFunction
            Resource: "{{resolve:ssm:/serverless-toolbox/ask-chatgpt}}"
```

### Send API Request

A common task in any application is to hit a 3rd party API. This function will call a web API with the provided configuration and return the body of the response.

**Example Input**

```json
{
  "secretKey": "key-from-auth-token-secret",
  "request": {
    "method": "POST",
    "baseUrl": "https://api.medium.com/posts",
    "headers": {
      "x-custom-header": "value"
    },
    "body": {
      "title": "My title",
      "body_markdown": "## Hello!"
    }
  },
  "auth": {
    "prefix": "Bearer",
    "location": "header",
    "key": "Authorization"
  },
  "query": {
    "custom-value": "anything-you-want"
  }
}
```

**Example Output**

```json
{
  "id": "A4G7222D"
}
```

**How to Invoke**

This is similar to the *ask-chatgpt* function in that it was intended to be called synchronously or as part of a workflow. See the example SAM resource of how to consume this function in a state machine.

```yaml
MySecondStateMachine:
  Type: AWS::Serverless::StateMachine
    Properties:
      Type: STANDARD
      DefinitionUri: workflows/my-definition.asl.json
      DefinitionSubstitutions:
        AskChatGPTFunctionArn: "{{resolve:ssm:/serverless-toolbox/send-api-request}}"
      Policies:
        - Version: 2012-10-17
          Statement:
            Effect: Allow
            Action: lambda:InvokeFunction
            Resource: "{{resolve:ssm:/serverless-toolbox/send-api-request}}"
```

### Send Email

If you wish to send an email via SendGrid, this function is ready for you. You will need to [get a SendGrid API key](https://docs.sendgrid.com/ui/account-and-settings/api-keys) and [verify your email address](https://docs.sendgrid.com/for-developers/sending-email/sender-identity). After the initial setup is done, you can send emails with a simple event publish!

**How to Invoke**

This function is triggered via an EventBridge rule. Please refer to the example below publishing a `Send Email` event.

**Example Input**

```json
{
  "DetailType": "Send Email",
  "Source": "my.app",
  "Detail": {
    "subject": "Dear reader",
    "to": "personToRecieveEmail@mailinator.com",
    "html": "<h1>Hello!</h1>"
  }
}
```
If you don't wish to use an html format in your email, you can use a `text` property instead in the `Detail` object.

### Set Log Retention

This is a function with an administrative purpose. As you build more and more Lambda functions, you begin to accumulate CloudWatch logs with unlimited retention. Rarely do we need Lambda logs forever, so this function is set to run every day and set any new function logs to a configurable retention period.

As you build new functions, they will be picked up automatically and the retention period will be updated. If you wish to change the retention period, it is an environment variable configured in the template.

**Example Input**

None

**How to Invoke**

Triggered automatically by an EventBridge scheduled invoke every day.