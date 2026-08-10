function formatAxiosError(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error.response) {
    const {status, statusText} = error.response;
    const statusDescription = [status, statusText]
        .filter((value) => value !== undefined && value !== null && value !== '')
        .join(' ');
    return `HTTP ${statusDescription || 'error'} - response body omitted`;
  }

  if (error.request) {
    return 'No response received from remote server';
  }

  if (error.message) {
    return error.message;
  }

  return String(error);
}

module.exports = {formatAxiosError};
