const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

exports.handler = async (state) => {
  if (state.marshall) {
    const data = marshall(state.data);
    return { data };
  } else {
    let data;
    if (state.isDynamoDBQuery) {
      data = state.data.map(d => unmarshall(d));
    } else {
      data = unmarshall(state.data);
    }

    return { data };
  }
};
