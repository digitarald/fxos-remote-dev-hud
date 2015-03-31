import './index.styl';

import React from 'react';
import d3 from 'd3';
import _ from 'lodash';
import prettysize from 'prettysize';
import update from 'react/lib/update';
import cx from 'classnames';

const MEMORY_FIELDS = {
	dom: {
		label: 'DOM'
	},
	style: {
		label: 'Style'
	},
	jsObjects: {
		label: 'JS Objects'
	},
	jsStrings: {
		label: 'JS Strings'
	},
	jsOther: {
		label: 'JS Other'
	},
	other: {
		label: 'Other'
	}
};
let scale = d3.scale.category10();
const MEMORY_FIELDS_KEYS = Object.keys(MEMORY_FIELDS);
_.forEach(MEMORY_FIELDS_KEYS, (key, idx) => {
	MEMORY_FIELDS[key].color = scale(idx);
});
let appColor = 0;

class App extends React.Component {
	constructor(props) {
    super(props);
    this.state = {
			events: [],
			online: false,
			device: null,
			apps: {},
			ussList: {},
			memoryList: {},
			first: 0,
			last: 0,
			ready: false,
			mps: 0.0
		};
    _.bindAll(this, Object.getOwnPropertyNames(this.constructor.prototype));
  }

	componentDidMount() {
		let source = new EventSource('/stream');
		source.addEventListener('deviceAdd', this.handleDeviceAdd, false);
		source.addEventListener('deviceRemove', this.handleDeviceRemove, false);
		source.addEventListener('uss', this.handleUss, false);
		source.addEventListener('appMemory', this.handleAppMemory, false);
		source.addEventListener('alias', this.handleAppAlias, false);
		source.addEventListener('ready', this.handleSourceReady, false);
		source.addEventListener('open', this.handleSourceOpen, false);
		source.addEventListener('error', this.handleSourceError, false);
	}

	shouldComponentUpdate(nextProps, nextState) {
		return nextState.ready;
	}

	handleSourceOpen() {
		this.setState({
			online: true
		});
	}

	handleSourceError() {
		this.setState({
			online: false
		});
	}

	handleSourceReady() {
		alert('Ready!');
		this.setState({
			ready: true
		});
	}

	handleDeviceAdd(event) {
		let data = JSON.parse(event.data);
		this.setState({
			device: data.id
		});
	}

	handleDeviceRemove(event) {
		let data = JSON.parse(event.data);
		this.setState({
			device: null,
			lastDevice: data.id
		});
	}

	handleUss(event) {
		this.updateMps();
		let {app, value, time} = JSON.parse(event.data);
		// console.log('handleUss', app);
		let extra = {
			uss: value,
			time: time,
			key: app
		};
		let exists = app in this.state.apps;
		if (!exists) {
			extra.created = time;
			extra.color = scale(appColor++);
		}
		let state = {
			apps: update(this.state.apps, {
				[app]: {
					[exists ? '$merge' : '$set']: extra
				}
			}),
			ussList: update(this.state.ussList, {
				[app]: {
					[this.state.ussList[app] ? '$push' : '$set']: [extra]
				}
			}),
			last: time,
			mps: this.mps
		};
		if (!this.state.first || this.state.first > time) {
			state.first = time;
		}
		this.setState(state);
	}

	handleAppMemory(event) {
		this.updateMps();
		let {app, value, extra, time} = JSON.parse(event.data);
		// console.log('handleAppMemory', app);
		extra.overall = value;
		extra.time = time;
		let exists = app in this.state.apps;
		if (!exists) {
			extra.created = time;
			extra.key = app;
			extra.color = scale(appColor++);
		}
		let state = {
			apps: update(this.state.apps, {
				[app]: {
					[exists ? '$merge' : '$set']: extra
				}
			}),
			memoryList: update(this.state.memoryList, {
				[app]: {
					[this.state.memoryList[app] ? '$push' : '$set']: [extra]
				}
			}),
			last: time,
			mps: this.mps
		};
		if (!this.state.first || this.state.first > time) {
			state.first = time;
		}
		this.setState(state);
	}

	handleAppAlias(event) {
		let {app, alias} = JSON.parse(event.data);
		console.log('handleAppAlias', app, alias);
		this.setState({
			apps: update(this.state.apps, {
				[app]: {
					alias: {
						$set: alias
					}
				}
			})
		});
	}

	updateMps() {
		let now = Date.now();
		if (this.lastEvent) {
			let diff = now - this.lastEvent;
			if (this.mps) {
				this.mps = this.mps * 0.9 + diff * 0.1;
			} else {
				this.mps = diff;
			}
		}
		this.lastEvent = now;
	}

	handleAppChange(app, to) {
		this.setState({
			apps: update(this.state.apps, {
				[app]: {
					hidden: {
						$set: !to
					}
				}
			})
		});
	}

	handleAppSelect(app) {
		this.setState({
			selected: (this.state.selected == app) ? null : app
		});
	}

	render() {
		if (!this.state.ready) {
			return (
				<main>Streaming incoming …</main>
			);
		}
		let {selected} = this.state;
		let online = this.state.online ? 'Online' : 'Offline';
		let device = this.state.device || 'No device';
		let $memoryList = this.state.selected ? (
			<MemoryList
				list={this.state.memoryList[this.state.selected]} />
		) : null;
		return (
			<main>
				<Chart
					list={selected ? this.state.memoryList[selected] : this.state.ussList}
					apps={selected ? null : this.state.apps}
					first={selected ? null : this.state.first}
					last={selected ? null : this.state.last}
					selected={selected} />
				<aside>
					<AppList
						apps={this.state.apps}
						last={this.state.last}
						onAppChange={this.handleAppChange}
						onAppSelect={this.handleAppSelect}
						selected={selected} />
					{$memoryList}
					<span>{Math.round(1000 / this.state.mps)} m/s</span>
				</aside>
			</main>
		);
	}
}

class Chart extends React.Component {
	constructor(props) {
		super(props);
		this.state = {
			width: 800,
			height: 600,
			timeSpan: 100000
		};
    _.bindAll(this, Object.getOwnPropertyNames(this.constructor.prototype));
	}

	componentDidMount() {
		window.addEventListener('resize', _.throttle(this.handleResize, 250));
		this.handleResize();
	}

	handleResize() {
		let el = this.refs.wrapper.getDOMNode();
		let height = el.offsetHeight;
		let width = el.offsetWidth;
		this.setState({
			width: width,
			height: height
		});
	}

	render() {
		let {list, selected, apps} = this.props;

		let timeRange = [
			selected ? _.first(list).time : this.props.first,
			selected ? _.last(list).time : this.props.last
		];
		let timeDrawRange = [
			timeRange[1] - this.state.timeSpan,
			timeRange[1]
		];
		let memDrawRange = [+Infinity, -Infinity];

		if (selected) {
			debugger;
			list = list
				.filter((snapshot) => {
					return snapshot.time >= timeDrawRange[0]
						&& snapshot.time <= timeDrawRange[1]
				})
				.reduce((split, snapshot) => {
					if (split == null) {
						split = {};
						MEMORY_FIELDS_KEYS.forEach((field) => {
							split[field] = [];
						});
					}
					MEMORY_FIELDS_KEYS.forEach((field) => {
						let value = snapshot[field];
						if (value < memDrawRange[0]) {
							memDrawRange[0] = value;
						}
						if (value > memDrawRange[1]) {
							memDrawRange[1] = value;
						}
						split[field].push({
							x: snapshot.time,
							y: snapshot[field]
						});
					});
					return split;
				}, null);
		} else {
			list = _.reduce(list, (split, snapshots, app) => {
				if (apps[app].hidden) {
					return split;
				}
				split[app] = snapshots
					.filter((snapshot) => {
						return snapshot.time >= timeDrawRange[0]
							&& snapshot.time <= timeDrawRange[1]
					})
					.map((snapshot) => {
						let value = snapshot.uss;
						if (value < memDrawRange[0]) {
							memDrawRange[0] = value;
						}
						if (value > memDrawRange[1]) {
							memDrawRange[1] = value;
						}
						return {
							x: snapshot.time,
							y: value
						};
					});
				return split;
			}, {});
		}

		let xScale = d3.scale.linear()
			.domain([
				timeDrawRange[0] - timeRange[0],
				timeDrawRange[1] - timeRange[0]
			])
			.range([0, this.state.width]);
		let yScale = d3.scale.linear()
			.domain([Math.max(memDrawRange[0] - 0.1, 0), memDrawRange[1] + 0.1])
			.nice()
			.range([this.state.height, 0]);

		let $paths = _.map(list, (values, key) => {
			let colorFields = selected ? MEMORY_FIELDS : apps;
			return (
				<Path
					key={key}
					xScale={xScale}
					yScale={yScale}
					data={values}
					color={colorFields[key].color} />
			);
		});

		return (
			<div className='app-graph' ref='wrapper'>
				<svg width={this.state.width} height={this.state.height}>
					{$paths}
				</svg>
			</div>
		);
	}
}

class Path extends React.Component {
	constructor(props) {
		super(props);
    _.bindAll(this, Object.getOwnPropertyNames(this.constructor.prototype));
	}

	getDefaultProps() {
		return {
			interpolate: 'linear',
			color: 'black'
		}
	}

	render() {
		let props = this.props;
		let path = d3.svg.line()
			.x(function(d) {
				return props.xScale(d.x);
			})
			.y(function(d) {
				return props.yScale(d.y);
			})
			.interpolate('linear');

		return (
			<path d={path(props.data)} stroke={props.color} strokeWidth='2' fill='none' />
		)
	}
}

class AppList extends React.Component {
	constructor(props) {
		super(props);
    _.bindAll(this, Object.getOwnPropertyNames(this.constructor.prototype));
	}

	handleChange(app, evt) {
		this.props.onAppChange(app, evt.target.checked);
	}

	handleSelect(app, evt) {
		this.props.onAppSelect(app);
	}

	render() {
		let $list = _.chain(this.props.apps)
			.sortBy(
				'created'
			)
			.reverse()
			.map((app) => {
				let cls = {
					'app-hidden': app.hidden,
					'app-selected': this.props.selected == app.key,
					'app-stale': app.time + 1000 < this.props.last
				}
				return (
					<li key={app.key} className={cx(cls)} title={app.time + 1000 < this.props.last}>
						<input
							type='checkbox'
							title='Show'
							defaultChecked={!app.hidden}
							onChange={this.handleChange.bind(this, app.key)} />
						<span
							className='name'
							onClick={this.handleSelect.bind(this, app.key)}
						>{app.alias || app.key}</span>
						<em>{prettysize(app.uss || app.overall)}</em>
					</li>
				);
			})
			.value();
		return (
			<ul className='app-list'>
				{$list}
			</ul>
		);
	}
}

class MemoryList extends React.Component {
	constructor(props) {
		super(props);
    _.bindAll(this, Object.getOwnPropertyNames(this.constructor.prototype));
	}

	render() {
		let last = _.last(this.props.list);
		let $list = _.chain(MEMORY_FIELDS_KEYS)
			.map((field) => {
				if (MEMORY_FIELDS_KEYS.indexOf(field) == -1) {
					return null;
				}
				let value = last[field];
				let style = {
					color: MEMORY_FIELDS[field].color
				};
				let label = MEMORY_FIELDS[field].label;
				return (
					<li key={field}>
						<span style={style} className='name'>{label}</span>
						<em>{prettysize(value)}</em>
					</li>
				);
			})
			.compact()
			.value();
		return (
			<ul className='memory-list'>
				{$list}
			</ul>
		);
	}
}

React.render(
	<App />,
	document.body
);