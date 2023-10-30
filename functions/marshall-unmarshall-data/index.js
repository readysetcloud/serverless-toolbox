const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

exports.handler = async (state) => {
  if (state.marshall) {
    const data = marshall(state.data);
    return { data };
  } else {
    const data = unmarshall(state.data);
    return { data };
  }
};
