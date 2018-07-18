import React from 'react'
import PropTypes from 'prop-types'

import camelCase from 'lodash/camelCase'
import extend from 'lodash/extend'
import has from 'lodash/has'
import mapKeys from 'lodash/mapKeys'
import omit from 'lodash/omit'
import {Parser} from 'json2csv';

import {withServer} from './HOCs'
import {handleFetchDataFailure} from '../../lib/utils'

import filesaver from '../../lib/filesaver';
var saveAs = filesaver.saveAs;

const propTypesContainer = {
  limit: PropTypes.number,
  page: PropTypes.number,
  usePaging: PropTypes.bool,
  refresh: PropTypes.bool,
  server: PropTypes.object,
}

/**
 * Wrap a component with Horizon data fetching abilities.

 * @param fetchDataFn {Function => Promise} Function that makes a call to the
 *          server requesting the required data. Returns a Promise resolving to
 *          the result data.
 * @param rspRecToPropsRecFn {Function} Converts from server response record
 *          format to some other format that the consuming container expects.
 * @param callBuilderFn {Function => CallBuilder} Function that returns a
 *          CallBuilder instance for the type of data being requested. This
 *          CallBuilder is used to setup a stream() to receive updates.
 */
const withDataFetchingAllContainer = (
  fetchDataFn,
  callBuilderFn
) => Component => {
  const rspRecToPropsRecFn = record => {
    record = mapKeys(record, (v, k) => camelCase(k));
    return omit(record, ['links', 'pagingToken']);
  }

  const dataFetchingContainerClass = class extends React.Component {
    static defaultProps = {
      limit: 100,
      page: 0,
      refresh: false,
      usePaging: false,
    }

    state = {
      cursor: 0,
      wasExportStarted: false,
      isExportingFinished: false,
      fetchedRecords: [],
    }

    componentDidMount() {
      this.fetchDataFn = (state) => {
        this.fetchData(state.next());
      }
    }

    componentWillUnmount() {
      this.fetchDataFn = null;
    }

    /*
     * This function fetches the entire dataset recursively.
     */
    fetchData(fetchDataPromise) {
      fetchDataPromise
        .then(r => this.responseToState(r))
        .then(newState => {
          this.setState(newState);
          return null;
        })
        .then(() => {
          if (this.state.cursor === 0 && this.state.fetchedRecords.length > 0) {
            this.setState({isExportingFinished: true});
            var csvData = new Parser().parse(this.state.fetchedRecords);
            const autoByteOrderMark = true;
            saveAs(new Blob([ '\ufeff', csvData ],
                   { type: 'text/csv;charset=utf-8' }),
                   'stellar-export.csv', autoByteOrderMark);
            return;
          }

          const isEndReached = this.state.cursor === 0 &&
                               this.state.fetchedRecords.length === 0;
          if (this.state.wasExportStarted && isEndReached) {
            this.setState({isExportingFinished: true});
            return;
          }

          if (this.state.wasExportStarted && this.fetchDataFn !== null && this.state.cursor !== 0) {
            this.fetchDataFn(this.state);
          }
        })
        .catch(e => {
          handleFetchDataFailure()(e)
          this.setState({wasExportStarted: false})
        })
    }

    responseToState(rsp) {
      const cursor =
        rsp.records.length > 0 && has(rsp.records[0], 'paging_token')
          ? rsp.records[0].paging_token
          : 0
      if (cursor === 0) {
        console.warn('no cursor')
      }

      return {
        next: rsp.next,
        prev: rsp.prev,
        fetchedRecords: this.state.fetchedRecords.concat(rsp.records.map(rspRecToPropsRecFn)),
        cursor,
        parentRenderTimestamp: Date.now(),
      }
    }

    render() {
      return (
        <div>
          <Component
            wasExportStarted={this.state.wasExportStarted}
            isExportingFinished={this.state.isExportingFinished}
            onClick={() => {
              const newState = {limit: 100, wasExportStarted: true};
              this.setState(newState);

              var initial = extend({}, this.props, newState);
              this.fetchData(fetchDataFn(initial));
            }}
            fetchedRecords={this.state.fetchedRecords}
            parentRenderTimestamp={this.state.parentRenderTimestamp}
            {...this.props}
          />
        </div>
      )
    }
  }

  dataFetchingContainerClass.propTypes = propTypesContainer

  return withServer(dataFetchingContainerClass)
}

export {withDataFetchingAllContainer}
